import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Button. Variants: primary, secondary, ghost, danger. Every size meets the 44px touch target.
 * Pass `as={Link}` (react-router) to render a link styled as a button.
 */
const Button = forwardRef(function Button(
  {
    as: Component = 'button',
    variant = 'primary',
    size = 'md',
    icon: Icon,
    iconPosition = 'start',
    fullWidth = false,
    loading = false,
    disabled,
    className = '',
    children,
    type,
    ...rest
  },
  ref
) {
  const classes = [
    'ui-button',
    `ui-button--${variant}`,
    `ui-button--${size}`,
    fullWidth && 'ui-button--full',
    !children && 'ui-button--icon-only',
    className,
  ].filter(Boolean).join(' ');

  const iconNode = loading
    ? <Loader2 className="ui-button__icon ui-button__icon--spin" aria-hidden="true" />
    : Icon && <Icon className="ui-button__icon" aria-hidden="true" />;

  return (
    <Component
      ref={ref}
      className={classes}
      type={Component === 'button' ? type || 'button' : type}
      disabled={Component === 'button' ? disabled || loading : undefined}
      aria-disabled={Component !== 'button' && disabled ? true : undefined}
      aria-busy={loading || undefined}
      {...rest}
    >
      {iconPosition === 'start' && iconNode}
      {children && <span className="ui-button__label">{children}</span>}
      {iconPosition === 'end' && iconNode}
    </Component>
  );
});

export default Button;
