import clsx from 'clsx'
import { IconCheckOutline16 } from './icons.js'
import styles from './Checkbox.module.css'

/** 勾选框；支持半选（indeterminate），用于列表的全选状态。 */
export const Checkbox = ({
  checked,
  indeterminate = false,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  checked: boolean
  indeterminate?: boolean
  onChange: (checked: boolean) => void
  ariaLabel: string
  disabled?: boolean
}) => (
  <button
    type="button"
    role="checkbox"
    aria-checked={indeterminate ? 'mixed' : checked}
    aria-label={ariaLabel}
    className={clsx(styles.checkbox, (checked || indeterminate) && styles.checked)}
    disabled={disabled}
    onClick={() => onChange(!checked)}
  >
    {indeterminate ? <span className={styles.dash} /> : checked ? <IconCheckOutline16 /> : null}
  </button>
)
