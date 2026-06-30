import {
  Body,
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

type OtpEmailTemplateProps = {
  otp: string
  preview: string
  to: string
}

export function OtpEmailTemplate({ otp, preview, to }: OtpEmailTemplateProps) {
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
              Sign in to devpush
            </Heading>

            <Text
              className="text-[16px] leading-[24px]"
              style={{ color: emailTheme.foreground }}
            >
              Enter this temporary verification code to continue:
            </Text>

            <Section className="mt-[24px] mb-[24px] text-center">
              <pre
                className="inline-block rounded-lg border-0 text-[28px] font-medium"
                style={{
                  backgroundColor: emailTheme.muted,
                  color: emailTheme.foreground,
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                  letterSpacing: '8px',
                  lineHeight: 1,
                  marginBottom: 0,
                  marginTop: 0,
                  padding: '12px 4px 12px 12px',
                }}
              >
                {otp}
              </pre>
            </Section>

            <Text
              className="text-[16px] leading-[24px]"
              style={{ color: emailTheme.foreground }}
            >
              This code will expire in 5 minutes.
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
