import type { ReactNode } from 'react'
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
import { config } from '#devpush/server/config'
import { emailTheme } from './theme'

export function EmailLayout({
  title,
  preview,
  to,
  children,
  allowIgnore = true,
}: {
  title: string
  preview: string
  to: string
  children: ReactNode
  allowIgnore?: boolean
}) {
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
                width="32"
                height="32"
                src={new URL(
                  '/logo-email.png?v=2',
                  config.BETTER_AUTH_URL,
                ).toString()}
              />
            </Section>
            <Heading
              className="my-[30px] mx-0 p-0 text-center text-[24px] font-semibold tracking-tight"
              style={{ color: emailTheme.foreground }}
            >
              {title}
            </Heading>
            {children}
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
              .
              {allowIgnore
                ? ' If you think this is a mistake, you can safely ignore this email.'
                : ''}
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}
