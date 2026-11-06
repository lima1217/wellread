import React, { useEffect, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { getMcpConnectInfo, type McpConnectInfo } from '@/services/wellread/assistant/eveClient';
import { claudeMcpAddCommand, mcpServersJson } from '@/services/wellread/assistant/readerLive';
import { useEveConnectionStore } from '@/services/wellread/eveConnectionStore';
import { writeTextToClipboard } from '@/utils/clipboard';
import { eventDispatcher } from '@/utils/event';
import BoxedList from './primitives/BoxedList';
import SettingsRow from './primitives/SettingsRow';
import Tips from './primitives/Tips';

/**
 * Connect external agents (Claude Code, other MCP clients) to Wellread's MCP
 * server. The command points at the bundled Node runtime and bridge script,
 * so it is only known once the local sidecar is running.
 */
const ExternalAgentsSection: React.FC = () => {
  const _ = useTranslation();
  const ready = useEveConnectionStore((s) => s.ready);
  const sidecar = useEveConnectionStore((s) => s.info);
  const [info, setInfo] = useState<McpConnectInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!ready) {
      setInfo(null);
      return;
    }
    void getMcpConnectInfo()
      .then((next) => {
        if (!cancelled) setInfo(next);
      })
      .catch(() => {
        if (!cancelled) setInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, sidecar]);

  const copy = async (text: string) => {
    const ok = await writeTextToClipboard(text);
    eventDispatcher.dispatch('toast', {
      type: ok ? 'info' : 'error',
      message: ok ? _('Copied to clipboard') : _('Failed to copy'),
    });
  };

  const unavailable = ready ? undefined : _('Enable AI to connect external agents');
  const rows = [
    {
      label: _('Claude Code'),
      description: unavailable ?? _('Copy the command and run it in a terminal'),
      text: info ? claudeMcpAddCommand(info) : null,
    },
    {
      label: _('Other MCP clients'),
      description: unavailable ?? _('Copy the mcpServers JSON into the client config'),
      text: info ? mcpServersJson(info) : null,
    },
  ];

  return (
    <div className='space-y-2'>
      <BoxedList title={_('External Agents (MCP)')} data-setting-id='settings.ai.externalAgents'>
        {rows.map((row) => (
          <SettingsRow
            key={row.label}
            label={row.label}
            description={row.description}
            disabled={!row.text}
          >
            <button
              type='button'
              className='btn btn-ghost eink-bordered btn-sm shrink-0'
              disabled={!row.text}
              onClick={() => row.text && void copy(row.text)}
            >
              {_('Copy')}
            </button>
          </SettingsRow>
        ))}
      </BoxedList>
      <Tips>
        <li>
          {_(
            'Agents work while Wellread is open, on the book you are reading, with the same tools as the Reading Assistant.',
          )}
        </li>
        <li>
          {_(
            'They see your position, selection and Ask about this quotes, and follow Spoiler guard and Share highlights and notes.',
          )}
        </li>
      </Tips>
    </div>
  );
};

export default ExternalAgentsSection;
