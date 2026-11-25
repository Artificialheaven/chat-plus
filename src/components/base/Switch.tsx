import clsx from 'clsx'
import styles from './Switch.module.css'

/** 设置项用的开关；按钮语义，支持键盘空格/回车切换。 */
export const Switch = ({
  checked,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  ariaLabel: string
  disabled?: boolean
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    className={clsx(styles.switch, checked && styles.checked)}
    disabled={disabled}
    onClick={() => onChange(!checked)}
  >
    <span className={styles.thumb} />
  </button>
)
