import { HTMLAttributes } from 'react';

type Status = 'shipped' | 'progress';

type Props = HTMLAttributes<HTMLSpanElement> & {
  status: Status;
  children: React.ReactNode;
};

/**
 * StatusPill — wraps .status-shipped (teal) or .status-progress (purple).
 *
 * Use for project status, deployment state, etc.
 */
export function StatusPill({ status, children, className = '', ...rest }: Props) {
  const variantClass = status === 'shipped' ? 'status-shipped' : 'status-progress';
  return (
    <span className={`status-pill ${variantClass} ${className}`} {...rest}>
      {children}
    </span>
  );
}
