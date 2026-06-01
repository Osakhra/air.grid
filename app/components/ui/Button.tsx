import { forwardRef, ButtonHTMLAttributes, AnchorHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'outline';

type BaseProps = {
  variant?: ButtonVariant;
  children: React.ReactNode;
  className?: string;
};

type ButtonAsButton = BaseProps & ButtonHTMLAttributes<HTMLButtonElement> & { href?: never };
type ButtonAsAnchor = BaseProps & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

type Props = ButtonAsButton | ButtonAsAnchor;

/**
 * Button — wraps the .btn-primary / .btn-outline utility classes.
 *
 * If you pass `href`, it renders an <a>. Otherwise a <button>.
 *
 *   <Button variant="primary" onClick={...}>Click me</Button>
 *   <Button variant="outline" href="/somewhere">Go there</Button>
 */
export const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, Props>(
  ({ variant = 'primary', className = '', children, ...rest }, ref) => {
    const cls = `${variant === 'primary' ? 'btn-primary' : 'btn-outline'} ${className}`.trim();

    if ('href' in rest && rest.href !== undefined) {
      return (
        <a
          ref={ref as React.Ref<HTMLAnchorElement>}
          className={cls}
          {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}
        >
          {children}
        </a>
      );
    }

    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        className={cls}
        {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
