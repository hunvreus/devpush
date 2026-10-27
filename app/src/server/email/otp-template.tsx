import { Section, Text } from '@react-email/components'
import { EmailLayout } from './layout'
import { emailTheme } from './theme'

type OtpEmailTemplateProps = {
  otp: string
  preview: string
  to: string
}

export function OtpEmailTemplate({ otp, preview, to }: OtpEmailTemplateProps) {
  return (
    <EmailLayout title={'Sign in to devpush'} preview={preview} to={to}>
      <Text
        className="text-[16px] leading-[24px]"
        style={{ color: emailTheme.foreground }}
      >
        Enter this temporary verification code to continue:
      </Text>

      <Section className="mt-[24px] mb-[24px] text-center">
        <pre
          className="inline-block rounded-lg border-0 text-[24px] font-medium"
          style={{
            backgroundColor: emailTheme.muted,
            color: emailTheme.foreground,
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            letterSpacing: '6px',
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
    </EmailLayout>
  )
}
