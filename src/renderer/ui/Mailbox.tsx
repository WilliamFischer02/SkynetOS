import { StateBox } from './StateBox.js';
import { PanelHead } from './PanelHead.js';
import { useCallback, useEffect, useState } from 'react';
import type { MailSide, MailboxMessage } from '@shared/mailbox.js';
import { forClipboard } from '@shared/mailbox.js';
import { useBoardStore } from '../store/useBoardStore.js';
import { Icon } from './Icon.js';

/**
 * The JARVIS mailbox panel. `M`.
 *
 * SkynetOS is the wire between the two halves of JARVIS. The Face is a claude.ai conversation and
 * cannot see this disk; the Hands are a terminal that can do anything on it. This panel is the one
 * click each way:
 *
 *   TO HANDS   type what the Face decided, and it lands in codex/mailbox/to-hands/. The next
 *              session briefing carries it, so the Hands do not have to remember to look.
 *   TO FACE    what the Hands wrote, with COPY FOR THE FACE next to it — one click to the
 *              clipboard, in a form that says where it came from.
 *
 * It is deliberately not a chat window. Correspondence between two agents that run at different
 * times, in different places, with different powers, is post — and post has a subject line, an
 * archive, and no expectation of an immediate reply.
 */

export function Mailbox(): React.JSX.Element | null {
  const open = useBoardStore((s) => s.mailboxOpen);
  const setOpen = useBoardStore((s) => s.setMailboxOpen);
  const toast = useBoardStore((s) => s.toast);

  const [side, setSide] = useState<MailSide>('hands');
  // `null` until the first read has answered: an empty list is a fact, an unread one is not.
  const [mail, setMail] = useState<MailboxMessage[] | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [toHands, toFace] = await Promise.all([
        window.skynet['mailbox:list']('hands'),
        window.skynet['mailbox:list']('face')
      ]);
      setMail(side === 'hands' ? toHands : toFace);
      setReadError(null);
    } catch (error) {
      setReadError(error instanceof Error ? error.message : String(error));
    }
  }, [side]);

  useEffect(() => { if (open) void refresh(); }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'Escape') { event.preventDefault(); setOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const send = async () => {
    if (!body.trim()) { toast('warn', 'NOTHING TO SEND'); return; }
    const result = await window.skynet['mailbox:send'](side, {
      // The Face has no way to write here itself, so a message put in by hand is FROM the Face
      // as far as the Hands are concerned — that is exactly what carrying it across means.
      from: side === 'hands' ? 'face' : 'hands',
      // Empty is fine: a pasted header's own subject: fills it, and failing that, "No subject".
      subject: subject.trim(),
      body: body.trim()
    });
    if (!result.ok) { toast('fault', result.error ?? 'COULD NOT SEND'); return; }
    setSubject('');
    setBody('');
    await refresh();
    toast('ok', `left in codex/mailbox/to-${side}/`);
  };

  const copy = async (message: MailboxMessage) => {
    try {
      await navigator.clipboard.writeText(forClipboard(message));
      toast('ok', 'copied — paste it to the Face');
    } catch {
      toast('warn', `COULD NOT REACH THE CLIPBOARD — OPEN ${message.file} AND COPY IT BY HAND`);
    }
  };

  const archive = async (message: MailboxMessage) => {
    const result = await window.skynet['mailbox:archive'](side, message.file);
    if (!result.ok) { toast('fault', result.error ?? 'COULD NOT ARCHIVE'); return; }
    await refresh();
    toast('ok', 'moved to codex/mailbox/archive/');
  };

  return (
    <div className="mailbox">
      <PanelHead name="JARVIS MAILBOX" icon="mail" onClose={() => setOpen(false)}>
        <button
          type="button"
          className={side === 'hands' ? 'btn primary' : 'btn'}
          onClick={() => setSide('hands')}
          title="Messages waiting for the Hands. Folded into the next session briefing automatically."
        >
          To the Hands
        </button>
        <button
          type="button"
          className={side === 'face' ? 'btn primary' : 'btn'}
          onClick={() => setSide('face')}
          title="Messages the Hands left for the Face. Copy one to carry it across."
        >
          To the Face
        </button>
      </PanelHead>

      <div className="mailbox-body">
        <div className="mailbox-list">
          <div className="section-head">
            {side === 'hands' ? 'WAITING FOR THE HANDS' : 'WAITING FOR THE FACE'} · {mail ? mail.length : '…'}
          </div>
          {readError ? (
            <StateBox tone="warn" line={`COULD NOT READ codex/mailbox/ — ${readError}`} detail="Close and reopen the mailbox (M) to try again." />
          ) : !mail ? (
            <div className="dim">READING codex/mailbox/…</div>
          ) : mail.length ? mail.map((message) => (
            <article className="mail" key={message.file}>
              <header className="mail-head">
                <span className="mail-subject">{message.subject}</span>
                <span className="mail-from">from {message.from}</span>
              </header>
              <pre className="mail-body">{message.body}</pre>
              <footer className="mail-actions">
                {side === 'face' ? (
                  <button type="button" className="btn" onClick={() => void copy(message)} title="Copy this message to the clipboard, ready to paste to the Face">
                    Copy for the Face
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn"
                  onClick={() => void archive(message)}
                  title="Moves it to codex/mailbox/archive/. Never deleted — 'what did the Face actually ask for' is a question you ask weeks later."
                >
                  Archive
                </button>
                <span className="mail-file" title={message.file}>{message.file}</span>
              </footer>
            </article>
          )) : (
            <div className="dim">
              NOTHING WAITING.
              {side === 'hands'
                ? ' Write below and the next launch of a JARVIS chip carries it.'
                : ' The Hands write here by dropping a file into codex/mailbox/to-face/.'}
            </div>
          )}
        </div>

        <form className="mailbox-compose" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <div className="section-head">
            {side === 'hands' ? 'LEAVE A MESSAGE FOR THE HANDS' : 'LEAVE A MESSAGE FOR THE FACE'}
          </div>
          <input
            className="input"
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
          <textarea
            className="input area"
            rows={6}
            placeholder={
              side === 'hands'
                ? 'Paste the Face\'s message whole, header included: its subject:, run: and standing: lines are honoured. It lands in codex/mailbox/to-hands/ and the next session opens holding it.'
                : 'Anything you want the Face told next time you talk to it.'
            }
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <button type="submit" className="btn primary" disabled={!body.trim()} title="Save this note in the mailbox for the next session to pick up">
            Leave it in the mailbox
          </button>
        </form>
      </div>

      <div className="mailbox-foot">
        codex/mailbox/ is git-tracked, so this correspondence travels with the repo. The protocol is
        in codex/mailbox/README.md — the Hands can read and write it directly.
      </div>
    </div>
  );
}
