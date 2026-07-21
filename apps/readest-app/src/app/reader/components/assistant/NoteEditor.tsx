import React, { useEffect, useRef, useState } from 'react';
import { useAssistantPanelStore } from '@/store/assistantPanelStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { TextSelection } from '@/utils/sel';
import { md5Fingerprint } from '@/utils/md5';
import { BookNote } from '@/types/book';
import useShortcuts from '@/hooks/useShortcuts';
import TextEditor, { TextEditorRef } from '@/components/TextEditor';
import TextButton from '@/components/TextButton';

interface NoteEditorProps {
  onSave: (selection: TextSelection, note: string) => void;
  onEdit: (annotation: BookNote) => void;
}

const NoteEditor: React.FC<NoteEditorProps> = ({ onSave, onEdit }) => {
  const _ = useTranslation();
  const {
    newAnnotation,
    editAnnotation,
    setNewAnnotation,
    setEditAnnotation,
    saveAnnotationDraft,
    getAnnotationDraft,
  } = useAssistantPanelStore();

  const editorRef = useRef<TextEditorRef>(null);
  const [note, setNote] = useState('');
  const separatorWidth = useResponsiveSize(3);

  useEffect(() => {
    if (editAnnotation) {
      const noteText = editAnnotation.note;
      setNote(noteText);
      editorRef.current?.setValue(noteText);
      editorRef.current?.focus();
    } else if (newAnnotation) {
      const noteText = getAnnotationText();
      if (noteText) {
        const draftNote = getAnnotationDraft(md5Fingerprint(noteText)) || '';
        setNote(draftNote);
        editorRef.current?.setValue(draftNote);
        editorRef.current?.focus();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newAnnotation, editAnnotation]);

  const getAnnotationText = () => {
    return editAnnotation?.text || newAnnotation?.text || '';
  };

  const handleNoteChange = (value: string) => {
    setNote(value);
  };

  const handleBlur = () => {
    const currentValue = editorRef.current?.getValue();
    if (currentValue) {
      const noteText = getAnnotationText();
      if (noteText) {
        saveAnnotationDraft(md5Fingerprint(noteText), currentValue);
      }
    }
  };

  const handleSaveNote = () => {
    const currentValue = editorRef.current?.getValue();
    if (currentValue) {
      if (newAnnotation) {
        onSave(newAnnotation, currentValue);
      } else if (editAnnotation) {
        editAnnotation.note = currentValue;
        onEdit(editAnnotation);
      }
    }
  };

  const handleEscape = () => {
    if (newAnnotation) {
      // Clearing the selection ends the creation flow; the panel reacts to that
      // and tears down the empty placeholder highlight it created (#4791).
      setNewAnnotation(null);
    }
    if (editAnnotation) {
      setEditAnnotation(null);
    }
  };

  useShortcuts({
    onSaveNote: () => {
      const currentValue = editorRef.current?.getValue();
      if (currentValue) {
        handleSaveNote();
      }
    },
    onEscape: handleEscape,
  });

  const canSave = Boolean(note.trim());

  return (
    <div className='content booknote-item note-editor-container bg-base-100 mt-2 rounded-md p-2'>
      <div className='flex w-full'>
        <TextEditor
          ref={editorRef}
          value={note}
          onChange={handleNoteChange}
          onBlur={handleBlur}
          onSave={handleSaveNote}
          onEscape={handleEscape}
          placeholder={_('Add your notes here...')}
          spellCheck={false}
        />
      </div>

      <div className='flex items-center pt-2'>
        <div
          className='me-2 mt-0.5 min-h-full self-stretch rounded-xl bg-gray-300'
          style={{
            minWidth: `${separatorWidth}px`,
          }}
        ></div>
        <div className='content font-size-sm line-clamp-3'>
          <span className='content font-size-xs text-gray-500'>{getAnnotationText()}</span>
        </div>
      </div>

      <div className='flex justify-end space-x-3 p-2' dir='ltr'>
        <TextButton onClick={handleEscape}>{_('Cancel')}</TextButton>
        <TextButton onClick={handleSaveNote} disabled={!canSave}>
          {_('Save')}
        </TextButton>
      </div>
    </div>
  );
};

export default NoteEditor;
