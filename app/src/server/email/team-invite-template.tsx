import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Tailwind,
  Text,
} from '@react-email/components'

import { config } from '@/server/config'
import { emailTheme } from '@/server/email/theme'

const emailLogoPath = '/logo-email.png'

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
  const logoUrl = new URL(emailLogoPath, config.BETTER_AUTH_URL).toString()

  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Tailwind>
        <Body
          className="my-auto mx-auto px-2 font-sans antialiased"
          style={{
            backgroundColor: emailTheme.background,
            color: emailTheme.foreground,
          }}
        >
          <Container className="my-[40px] mx-auto max-w-[465px] p-[20px]">
            <Section className="mt-[24px]">
              <Img
                alt="devpush"
                className="my-0 mx-auto"
                height="42"
                src={logoUrl}
                width="42"
              />
            </Section>

            <Heading
              className="my-[30px] mx-0 p-0 text-center text-[24px] font-semibold tracking-tight"
              style={{ color: emailTheme.foreground }}
            >
              Join {teamName} on devpush
            </Heading>

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
                  backgroundColor: emailTheme.foreground,
                  color: emailTheme.background,
                }}
              >
                Accept invitation
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
                href={inviteUrl}
                style={{ color: emailTheme.mutedLink }}
              >
                {inviteUrl}
              </Link>
            </Text>

            <Text
              className="mt-[36px] text-[14px] leading-[24px]"
              style={{ color: emailTheme.mutedForeground }}
            >
              This email was intended for{' '}
              <Link
                className="underline"
                href={`mailto:${to}`}
                style={{ color: emailTheme.mutedLink }}
              >
                {to}
              </Link>
              . If you think this is a mistake, you can safely ignore this
              email.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}
