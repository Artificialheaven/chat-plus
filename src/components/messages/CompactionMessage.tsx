import { memo } from 'react'
import { isTranslationKey, useTranslate } from '../../i18n/index.js'
import { formatTokenCount } from '../../services/chat/tokens.js'
import type { CompactError } from '../../services/chat/store.js'
import { formatDate } from '../../utils/format.js'
import { Button } from '../base/Button.js'
import { IconLoadingOutline16, IconWarningOutline16 } from '../base/icons.js'
import { Markdown } from '../markdown/Markdown.js'
import { CopyButton } from './CopyButton.js'
import styles from './CompactionMessage.module.css'

/**
 * 压缩摘要气泡：与助手消息同列展示，但不参与消息树和归档导出。
 * 生成中显示进度与停止按钮，失败时显示原因和重试。
 */
export const CompactionMessage = memo(function CompactionMessage({
  status,
  summary,
  createdAt,
  rounds = 0,
  beforeTokens = 0,
  afterTokens = 0,
  error,
  onRetry,
  onStop,
}: {
  status: 'done' | 'pending' | 'error'
  summary?: string
  createdAt?: number
  rounds?: number
  beforeTokens?: number
  afterTokens?: number
  error?: CompactError
  onRetry?: () => void
  onStop?: () => void
}) {
  const t = useTranslate()
  const title =
    status === 'pending'
      ? t('compactRunning')
      : status === 'error'
        ? t('compactFailed')
        : t('compactDone')
  const date = createdAt ? formatDate(createdAt) : null
  const errorText =
    error && error.localMessage && isTranslationKey(error.localMessage.key)
      ? t(error.localMessage.key, error.localMessage.params)
      : (error?.message ?? '')

  return (
    <div className={styles.message}>
      <div className={styles.card}>
        <div className={styles.header}>
          <span className={styles.badge}>{t('compactLabel')}</span>
          <span className={styles.title}>{title}</span>
          {date ? (
            <time className={styles.time} dateTime={new Date(createdAt ?? 0).toISOString()}>
              {date}
            </time>
          ) : null}
        </div>
        {status === 'done' ? (
          summary ? (
            <>
              <div className={styles.meta}>
                {t('compactSummaryMeta', {
                  rounds,
                  before: formatTokenCount(beforeTokens),
                  after: formatTokenCount(afterTokens),
                })}
              </div>
              <Markdown
                className={styles.summary}
                content={summary}
                loading={false}
                cacheKey={`compaction-${createdAt ?? 'done'}`}
                disableLink={false}
              />
              <div className={styles.actions}>
                <CopyButton text={summary} />
              </div>
            </>
          ) : null
        ) : status === 'pending' ? (
          <div className={styles.body}>
            <span className={styles.spinner}>
              <IconLoadingOutline16 />
            </span>
            <span>{t('compactRunningDescription', { count: rounds })}</span>
            {onStop ? (
              <Button variant="outlined" size="s" className={styles.stop} onClick={onStop}>
                {t('compactStop')}
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <div className={styles.errorRow}>
              <IconWarningOutline16 />
              <span>{errorText || t('compactFailed')}</span>
            </div>
            {onRetry && error?.retryable ? (
              <div className={styles.actions}>
                <Button variant="outlined" size="s" onClick={onRetry}>
                  {t('retry')}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
})
