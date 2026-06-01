import { HTMLAttributes, forwardRef } from 'react';

type Props = HTMLAttributes<HTMLDivElement> & {
  children: React.ReactNode;
};

/**
 * Card — wraps the .ac-card utility class.
 *
 * Standard surface element. Translucent dark background with blur,
 * subtle border that turns teal on hover.
 */
export const Card = forwardRef<HTMLDivElement, Props>(
  ({ children, className = '', ...rest }, ref) => (
    <div ref={ref} className={`ac-card ${className}`} {...rest}>
      {children}
    </div>
  )
);

Card.displayName = 'Card';
