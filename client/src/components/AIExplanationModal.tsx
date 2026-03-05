// client/src/components/AIExplanationModal.tsx
import React, { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';

// ─────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────

interface AIExplanationModalProps {
  explanation: string;
  isLoading:   boolean;
  onClose:     () => void;
}

// ─────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────

const AIExplanationModal: React.FC<AIExplanationModalProps> = ({
  explanation,
  isLoading,
  onClose,
}) => {
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const closeButtonRef   = useRef<HTMLButtonElement | null>(null);

  // ── Save focus, move into modal on mount ──
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    closeButtonRef.current?.focus();
    return () => {
      previousFocusRef.current?.focus();
    };
  }, []);

  // ── Escape key closes modal ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, isLoading]);

  // ── Click outside modal box closes it ──
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !isLoading) onClose();
  };

  // ─────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────

  return (
    <div
      className="modal-backdrop"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-label="AI Assistant"
        onClick={(e) => e.stopPropagation()}
      >

        {/* ── HEADER ── */}
        <div className="modal-header">
          <h3>✨ AI Assistant</h3>
          <button
            ref={closeButtonRef}
            className="modal-close"
            onClick={onClose}
            disabled={isLoading}
            aria-label="Close (Esc)"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        {/* ── BODY ── */}
        <div className="modal-body">
          {isLoading ? (
            <div className="loader">
              <div className="loader-spinner" />
              <p>Analyzing issue on GPU...</p>
            </div>
          ) : explanation ? (
            // ── Render AI markdown response ──
            <div className="markdown-body">
              <ReactMarkdown
                components={{
                  // Fenced code blocks: ```python ... ```
                  code({ node, className, children, ...props }: any) {
                    const isBlock = Boolean(className?.startsWith('language-'));
                    return isBlock ? (
                      <pre className="md-pre">
                        <code className={className} {...props}>
                          {children}
                        </code>
                      </pre>
                    ) : (
                      <code className="md-inline-code" {...props}>
                        {children}
                      </code>
                    );
                  },
                  p({ children }: any) {
                    return <p className="md-p">{children}</p>;
                  },
                  ul({ children }: any) {
                    return <ul className="md-ul">{children}</ul>;
                  },
                  ol({ children }: any) {
                    return <ol className="md-ol">{children}</ol>;
                  },
                  li({ children }: any) {
                    return <li className="md-li">{children}</li>;
                  },
                  strong({ children }: any) {
                    return <strong className="md-strong">{children}</strong>;
                  },
                  h1({ children }: any) {
                    return <h1 className="md-h">{children}</h1>;
                  },
                  h2({ children }: any) {
                    return <h2 className="md-h">{children}</h2>;
                  },
                  h3({ children }: any) {
                    return <h3 className="md-h md-h3">{children}</h3>;
                  },
                  // Horizontal rule as a subtle divider
                  hr() {
                    return <hr className="md-hr" />;
                  },
                  // Blockquotes for any quoted context
                  blockquote({ children }: any) {
                    return (
                      <blockquote className="md-blockquote">
                        {children}
                      </blockquote>
                    );
                  },
                }}
              >
                {explanation}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="no-issues">
              No explanation was returned. Try a different issue.
            </p>
          )}
        </div>

        {/* ── FOOTER ── */}
        <div className="modal-footer">
          <button
            className="modal-close-btn"
            onClick={onClose}
            disabled={isLoading}
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
};

export default AIExplanationModal;