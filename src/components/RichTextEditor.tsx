import { useCallback, useEffect, useRef } from 'react';
import { Bold, Italic, Underline, List, ListOrdered, Undo2, Redo2 } from 'lucide-react';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  rows?: number;
  placeholder?: string;
}

export function RichTextEditor({ value, onChange, rows = 8, placeholder }: RichTextEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const skipChangeRef = useRef(false);

  useEffect(() => {
    if (ref.current && skipChangeRef.current) {
      skipChangeRef.current = false;
      return;
    }
    if (ref.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value || '';
    }
  }, [value]);

  const exec = useCallback((command: string) => {
    document.execCommand(command, false);
    ref.current?.focus();
    if (ref.current && onChange) {
      skipChangeRef.current = true;
      onChange(ref.current.innerHTML);
    }
  }, [onChange]);

  const handleInput = useCallback(() => {
    if (ref.current) {
      skipChangeRef.current = true;
      onChange(ref.current.innerHTML);
    }
  }, [onChange]);

  const toolbarBtn = (icon: React.ReactNode, command: string, title: string) => (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => exec(command)}
      className="p-1.5 rounded hover:bg-slate-200 text-slate-600 transition-colors"
      title={title}
    >
      {icon}
    </button>
  );

  return (
    <div className="border border-slate-300 rounded-lg overflow-hidden focus-within:border-slate-400 focus-within:ring-1 focus-within:ring-slate-400">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-slate-200 bg-slate-50">
        {toolbarBtn(<Bold size={15} />, 'bold', 'Bold')}
        {toolbarBtn(<Italic size={15} />, 'italic', 'Italic')}
        {toolbarBtn(<Underline size={15} />, 'underline', 'Underline')}
        <div className="w-px h-5 bg-slate-300 mx-1" />
        {toolbarBtn(<List size={15} />, 'insertUnorderedList', 'Bullet List')}
        {toolbarBtn(<ListOrdered size={15} />, 'insertOrderedList', 'Numbered List')}
        <div className="w-px h-5 bg-slate-300 mx-1" />
        {toolbarBtn(<Undo2 size={15} />, 'undo', 'Undo')}
        {toolbarBtn(<Redo2 size={15} />, 'redo', 'Redo')}
      </div>
      <div
        ref={ref}
        contentEditable
        onInput={handleInput}
        onBlur={handleInput}
        className="px-3 py-2 text-sm text-slate-800 outline-none overflow-y-auto"
        style={{ minHeight: `${rows * 24}px`, maxHeight: `${rows * 24 + 60}px`, lineHeight: '1.5' }}
        data-placeholder={placeholder}
        suppressContentEditableWarning
      />
    </div>
  );
}
