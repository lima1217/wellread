# Self-hosting with Docker / Podman Compose

Run the Wellread web stack locally with Compose. This page covers setup, image choice, and common operations.

## Stack

| Service | Image | Description |
| ------- | ----- | ----------- |
| **client** | `ghcr.io/readest/readest` | Wellread web frontend |
| **db** | `supabase/postgres` | Postgres with Supabase extensions |
| **kong** | `kong:2.8.1` | API gateway for Supabase services |
| **auth** | `supabase/gotrue:v2.185.0` | Auth service (email, JWT) |
| **rest** | `postgrest/postgrest:v14.3` | Postgres REST API |
| **minio** | `minio/minio` | S3-compatible storage |
| **minio-setup** | `minio/mc` | Creates S3 buckets on first start |

### Exposed ports

| Port | Service |
| ---- | ------- |
| `3000` | Wellread web client |
| `8000` | Kong API gateway |
| `9000` | MinIO S3 API |
| `9001` | MinIO console UI |

## Running with Docker / Podman Compose

### 1. Set up `.env`

```bash
cp docker/.env.example docker/.env
```

Update `docker/.env`:

- Set `POSTGRES_PASSWORD` to a strong password (32+ chars)
- Set `JWT_SECRET` to a random secret (32+ chars)
- Regenerate `ANON_KEY` and `SERVICE_ROLE_KEY` as HS256 JWTs signed with your `JWT_SECRET` (use [jwt.io](https://jwt.io/) or a similar tool):
  - `ANON_KEY` payload: `{"role": "anon"}`
  - `SERVICE_ROLE_KEY` payload: `{"role": "service_role"}`
- Set `MINIO_ROOT_PASSWORD` to a strong password

### 2. Start the stack (pull prebuilt client image)

From the `docker/` directory:

```bash
cd docker
docker compose up -d
```

This pulls `${READEST_IMAGE}` (default: `ghcr.io/readest/readest:latest`) instead of building the client locally. The web client reads `SUPABASE_PUBLIC_URL`, `SUPABASE_ANON_KEY`, `API_BASE_URL`, `OBJECT_STORAGE_TYPE`, and `STORAGE_FIXED_QUOTA` from runtime container env, so custom self-hosted values work with pulled images.

For Docker Hub, set `READEST_IMAGE` in `docker/.env`, for example:

```env
READEST_IMAGE=docker.io/your_dockerhub_username/wellread:latest
```

Replace `your_dockerhub_username` with the Docker Hub namespace that publishes your image. Official prebuilt tags still use the `readest` image name until a Wellread-named registry path is published.

Published tags:

- `latest`: rolling image from the default branch and from release events
- `<release-tag>` (for example `v1.2.3`): published from release events
- `main`: rolling image from the default branch
- `sha-<commit>`: immutable commit tag

### Build locally instead of pulling

> **Prerequisites for local builds**: initialize the `packages/foliate-js` and `packages/simplecc-wasm` git submodules before building:
>
> ```bash
> git submodule update --init packages/foliate-js packages/simplecc-wasm
> ```
>
> In GitHub Codespaces this runs automatically via `.devcontainer/devcontainer.json`.

```bash
cd docker
docker compose -f compose.yaml -f compose.build.yaml up --build -d
```

### 3. Access

- Wellread app: `http://localhost:3000`
- MinIO console: `http://localhost:9001` (login with `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`)

### Hot reload (development)

> **Prerequisites**: submodules must be initialized (see above).

Use `compose.dev.yaml` to build the `development-stage` target (Next.js dev server) and mount your local repo for hot reload:

```bash
cd docker
docker compose -f compose.yaml -f compose.dev.yaml up --build -d
```

The first mount overlays your local repo into the container. The remaining anonymous volumes shadow image-baked directories so the container keeps its installed deps and vendor assets instead of your host copies.

### Stop the stack

```bash
cd docker
docker compose down
```

To also remove volumes (database and storage data):

```bash
cd docker
docker compose down -v
```

## Building the Dockerfile standalone

```bash
docker build \
  --target production-stage \
  --build-arg NEXT_PUBLIC_APP_PLATFORM=web \
  -t wellread-client \
  .
```

Run the built image:

```bash
docker run -p 3000:3000 \
  -e SUPABASE_URL=http://host.docker.internal:8000 \
  -e SUPABASE_PUBLIC_URL=http://localhost:8000 \
  -e SUPABASE_ANON_KEY=your_anon_key_here \
  -e SUPABASE_ADMIN_KEY=your_service_role_key_here \
  -e API_BASE_URL=http://localhost:3000 \
  -e OBJECT_STORAGE_TYPE=s3 \
  -e S3_ENDPOINT=http://host.docker.internal:9000 \
  -e S3_PUBLIC_ENDPOINT=http://localhost:9000 \
  -e S3_REGION=us-east-1 \
  -e S3_BUCKET_NAME=wellread-files \
  -e S3_ACCESS_KEY_ID=your_minio_user_here \
  -e S3_SECRET_ACCESS_KEY=your_minio_password_here \
  -e STORAGE_FIXED_QUOTA=1073741824 \
  wellread-client
```

On Linux, some Docker setups do not resolve `host.docker.internal` by default. Replace it with your host IP, or run with `--add-host=host.docker.internal:host-gateway`.
