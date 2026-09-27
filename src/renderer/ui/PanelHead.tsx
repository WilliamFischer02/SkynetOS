import { closeLabel } from '@shared/ui-copy.js';
import { Icon, type IconName } from './Icon.js';

/**
 * The one title strip every panel and popout carries.
 *
 * William, 2026-09-26: "expand the design to be consistent throughout any popout or otherwise."
 * Before this, LOOK, Settings and About shared `.look-head`, and the mailbox, the plan dialog,
 * the notification centre, the summon dialog and the drop-in wizard each drew their own strip
 * with its own class and its own idea of where the close button sat. Now: icon, ALL-CAPS name,
 * the panel's own controls, and the close hint at the right, always naming the key that closes it.
 */
export function PanelHead(props: {
  name: string;
  icon?: IconName;
  /** The key that closes the panel, for the hint. Default Esc. */
  closeKey?: string;
  onClose?: () => void;
  /** Extra controls between the name and the close button. */
  children?: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  const { name, icon, closeKey, onClose, children, className } = props;
  return (
    <div className={className ? `panel-head ${className}` : 'panel-head'}>
      <span className="with-icon panel-head-name">
        {icon ? <Icon name={icon} /> : null}
        {name}
      </span>
      {children}
      {onClose ? (
        <button type="button" className="btn tiny panel-head-close" onClick={onClose} title={`Close this panel (${closeKey ?? 'Esc'})`}>
          {closeLabel(closeKey)}
        </button>
      ) : null}
    </div>
  );
}
