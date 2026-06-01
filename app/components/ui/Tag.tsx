import { HTMLAttributes } from 'react';

type Props = HTMLAttributes<HTMLSpanElement> & {
  children: React.ReactNode;
};

/**
 * Tag — wraps the .ac-tag utility class.
 *
 * Small pill used for technology lists, skill tags, etc.
 */
export function Tag({ children, className = '', ...rest }: Props) {
  return (
    <span className={`ac-tag ${className}`} {...rest}>
      {children}
    </span>
  );
}
