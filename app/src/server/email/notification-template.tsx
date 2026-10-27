import { Button, Link, Section, Text } from '@react-email/components'
import { EmailLayout } from './layout'
import { emailTheme } from './theme'

export function NotificationEmailTemplate({
  title,
  message,
  to,
  action,
}: {
  title: string
  message: string
  to: string
  action?: { label: string; url: string }
}) {
  return (
    <EmailLayout title={title} preview={title} to={to} allowIgnore={false}>
      {message
        .split('\n')
        .filter(Boolean)
        .map((paragraph, index) => (
          <Text
            key={index}
            className="text-[16px] leading-[24px]"
            style={{ color: emailTheme.foreground }}
          >
            {paragraph}
          </Text>
        ))}
      {action ? (
        <>
          <Section className="my-[28px] text-center">
            <Button
              className="rounded-lg px-[18px] py-[10px] text-[14px] font-medium no-underline"
              href={action.url}
              style={{
                backgroundColor: emailTheme.primary,
                color: emailTheme.primaryForeground,
              }}
            >
              {action.label}
            </Button>
          </Section>
          <Text
            className="text-[14px] leading-[24px]"
            style={{ color: emailTheme.mutedForeground }}
          >
            If the button does not work, copy and paste this link into your
            browser:{' '}
            <Link
              className="break-all underline"
              href={action.url}
              style={{ color: emailTheme.mutedLink }}
            >
              {action.url}
            </Link>
          </Text>
        </>
      ) : null}
    </EmailLayout>
  )
}
