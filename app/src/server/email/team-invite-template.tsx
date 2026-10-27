import { Button, Link, Section, Text } from '@react-email/components'
import { EmailLayout } from './layout'
import { emailTheme } from './theme'

type TeamInviteEmailTemplateProps = {
  inviteUrl: string
  preview: string
  teamName: string
  to: string
}

export function TeamInviteEmailTemplate({
  inviteUrl,
  preview,
  teamName,
  to,
}: TeamInviteEmailTemplateProps) {
  return (
    <EmailLayout
      title={`Join ${teamName} on devpush`}
      preview={preview}
      to={to}
    >
      <Text
        className="text-[16px] leading-[24px]"
        style={{ color: emailTheme.foreground }}
      >
        You have been invited to join {teamName} on devpush.
      </Text>

      <Section className="mt-[28px] mb-[28px] text-center">
        <Button
          className="rounded-lg px-[18px] py-[10px] text-center text-[14px] font-medium no-underline"
          href={inviteUrl}
          style={{
            backgroundColor: emailTheme.primary,
            color: emailTheme.primaryForeground,
          }}
        >
          Accept invitation
        </Button>
      </Section>

      <Text
        className="text-[14px] leading-[24px]"
        style={{ color: emailTheme.mutedForeground }}
      >
        If the button does not work, copy and paste this link into your browser:{' '}
        <Link
          className="break-all underline"
          href={inviteUrl}
          style={{ color: emailTheme.mutedLink }}
        >
          {inviteUrl}
        </Link>
      </Text>
    </EmailLayout>
  )
}
