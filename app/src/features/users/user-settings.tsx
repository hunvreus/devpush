import { Link, useRouter } from '@tanstack/react-router'
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  EllipsisIcon,
  LoaderIcon,
  LogOutIcon,
  MailIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { authClient } from '@/lib/auth/client'
import { getErrorMessage } from '@/lib/error-message'
import { isValidEmail } from '@/lib/validation'
import { ResourceAvatar } from '@/components/resource-avatar'
import type { AuthUserContext } from '@/server/auth/context'
import {
  deleteUserAccountAction,
  disconnectAuthAccountAction,
  leaveTeamAction,
  requestEmailChangeAction,
  updateUserGeneralAction,
} from '@/server/users/functions'
import type {
  AuthAccountSummary,
  UserTeamSummary,
} from '@/server/users/service'

type UserSettingsContext = Omit<AuthUserContext, 'teams'> & {
  accounts: Array<AuthAccountSummary>
  authMethods: {
    email: boolean
    github: boolean
    google: boolean
  }
  teams: Array<UserTeamSummary>
}

type SocialProvider = 'github' | 'google'

export function UserSettings({ context }: { context: UserSettingsContext }) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { accounts, defaultTeam, teams, user } = context
  const [name, setName] = useState(user.name)
  const [username, setUsername] = useState(user.username)
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null)
  const [deleteAvatar, setDeleteAvatar] = useState(false)
  const [newEmail, setNewEmail] = useState(user.email)
  const [isSavingGeneral, setIsSavingGeneral] = useState(false)
  const [isSavingEmail, setIsSavingEmail] = useState(false)
  const [isDeletingAccount, setIsDeletingAccount] = useState(false)
  const [deleteAccountConfirmation, setDeleteAccountConfirmation] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pendingProvider, setPendingProvider] = useState<SocialProvider | null>(
    null,
  )
  const [accountToDisconnect, setAccountToDisconnect] =
    useState<AuthAccountSummary | null>(null)

  const avatarUrl = deleteAvatar ? null : (avatarDataUrl ?? user.image)
  const generalDirty =
    name.trim() !== user.name ||
    username.trim() !== user.username ||
    Boolean(avatarDataUrl) ||
    deleteAvatar
  const emailDirty = newEmail.trim().toLowerCase() !== user.email.toLowerCase()
  const normalizedNewEmail = newEmail.trim().toLowerCase()
  const emailIsValid = isValidEmail(normalizedNewEmail)
  const emailError =
    emailDirty && !emailIsValid
      ? normalizedNewEmail
        ? 'Enter a valid email address.'
        : 'Email is required.'
      : null
  const socialProviders = ['github', 'google'] as const
  const accountsByProvider = new Map(
    accounts.map((account) => [account.providerId, account]),
  )

  async function chooseAvatar(file: File | undefined) {
    if (!file) return

    if (
      !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(
        file.type,
      )
    ) {
      toast.error('Upload a PNG, JPEG, GIF, or WebP image.')
      return
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error('Avatars must be 2 MB or smaller.')
      return
    }

    setAvatarDataUrl(await readFileAsDataUrl(file))
    setDeleteAvatar(false)
  }

  async function saveGeneral() {
    setIsSavingGeneral(true)

    try {
      await updateUserGeneralAction({
        data: {
          name,
          username,
          avatarDataUrl,
          deleteAvatar,
        },
      })
      setAvatarDataUrl(null)
      setDeleteAvatar(false)
      toast.success('Account settings saved.')
      await router.invalidate()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to save account.'))
    } finally {
      setIsSavingGeneral(false)
    }
  }

  async function requestEmailChange() {
    if (!isValidEmail(normalizedNewEmail)) {
      toast.error('Invalid email address')
      return
    }

    setIsSavingEmail(true)

    try {
      await requestEmailChangeAction({ data: { newEmail: normalizedNewEmail } })
      toast.success('Verification email sent.')
      setNewEmail(user.email)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to update email.'))
    } finally {
      setIsSavingEmail(false)
    }
  }

  async function disconnectAccount(account: AuthAccountSummary) {
    setBusyId(account.id)

    try {
      await disconnectAuthAccountAction({
        data: {
          providerId: account.providerId,
          accountId: account.accountId,
        },
      })
      toast.success('Sign-in method disconnected.')
      await router.invalidate()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to disconnect account.'))
    } finally {
      setBusyId(null)
    }
  }

  async function connectProvider(provider: SocialProvider) {
    setPendingProvider(provider)

    try {
      const result = await authClient.linkSocial({
        provider,
        callbackURL: '/settings#authentication',
      })

      if (result.error) {
        toast.error(
          getErrorMessage(result.error, `Unable to connect ${provider}.`),
        )
        setPendingProvider(null)
      }
    } catch {
      toast.error(`Unable to connect ${provider}.`)
      setPendingProvider(null)
    }
  }

  async function leave(teamId: string) {
    setBusyId(teamId)

    try {
      await leaveTeamAction({ data: { teamId } })
      toast.success('You left the team.')
      await router.invalidate()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to leave team.'))
    } finally {
      setBusyId(null)
    }
  }

  async function deleteAccount() {
    setIsDeletingAccount(true)

    try {
      await deleteUserAccountAction({
        data: { confirmationName: deleteAccountConfirmation },
      })
      await authClient.signOut().catch(() => {})
      toast.success('Account deleted.')
      await router.navigate({ to: '/auth/login' })
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to delete account.'))
    } finally {
      setIsDeletingAccount(false)
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-screen-xl space-y-8 p-8">
        <header className="flex items-center gap-x-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild variant="outline" size="icon">
                <Link to="/" aria-label="Back to home">
                  <ArrowLeftIcon />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Back to home</TooltipContent>
          </Tooltip>
          <h1 className="text-2xl font-medium">Account settings</h1>
        </header>

        <div className="flex flex-row-reverse gap-x-8">
          <nav className="sticky top-8 hidden h-full min-w-64 flex-col gap-y-1 lg:flex">
            {['General', 'Email', 'Authentication', 'Teams', 'Danger'].map(
              (item) => (
                <Button
                  asChild
                  variant="ghost"
                  className={`justify-start font-normal ${
                    item === 'Danger' ? 'text-destructive' : ''
                  }`}
                  key={item}
                >
                  <a href={`#${item.toLowerCase()}`}>{item}</a>
                </Button>
              ),
            )}
          </nav>

          <div className="w-full space-y-8">
            <Card id="general" className="scroll-mt-8">
              <CardHeader className="border-b">
                <CardTitle>General</CardTitle>
                <CardDescription>
                  General settings for your account.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field>
                    <FieldLabel>Avatar</FieldLabel>
                    <div className="flex items-center gap-2">
                      <ResourceAvatar
                        name={name || username || user.email}
                        src={avatarUrl ?? undefined}
                        size="md"
                        className="rounded-full"
                      />
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/gif,image/webp"
                        className="hidden"
                        onChange={(event) => {
                          void chooseAvatar(event.target.files?.[0])
                          event.target.value = ''
                        }}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <UploadIcon data-icon="inline-start" />
                        Upload image
                      </Button>
                      {avatarUrl ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="destructive"
                              size="icon-sm"
                              type="button"
                              aria-label="Remove image"
                              onClick={() => {
                                setAvatarDataUrl(null)
                                setDeleteAvatar(true)
                              }}
                            >
                              <Trash2Icon />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Remove image</TooltipContent>
                        </Tooltip>
                      ) : null}
                    </div>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="account-name">Name</FieldLabel>
                    <Input
                      id="account-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="account-username">Username</FieldLabel>
                    <Input
                      id="account-username"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                    />
                  </Field>
                </FieldGroup>
              </CardContent>
              <CardFooter className="justify-end gap-2">
                <Button
                  variant="ghost"
                  disabled={!generalDirty || isSavingGeneral}
                  onClick={() => {
                    setName(user.name)
                    setUsername(user.username)
                    setAvatarDataUrl(null)
                    setDeleteAvatar(false)
                  }}
                >
                  Cancel
                </Button>
                <Button
                  disabled={!generalDirty || isSavingGeneral}
                  onClick={saveGeneral}
                >
                  {isSavingGeneral ? (
                    <LoaderIcon
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                  ) : null}
                  Save
                </Button>
              </CardFooter>
            </Card>

            <Card id="email" className="scroll-mt-8">
              <CardHeader className="border-b">
                <CardTitle>Email</CardTitle>
                <CardDescription>
                  The email address used for authentication and notifications.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Field data-invalid={Boolean(emailError)}>
                  <FieldLabel htmlFor="account-email">Email</FieldLabel>
                  <Input
                    aria-invalid={Boolean(emailError)}
                    id="account-email"
                    value={newEmail}
                    onChange={(event) => setNewEmail(event.target.value)}
                  />
                  <FieldDescription>
                    Verification is required before the new email is used for
                    sign in.
                  </FieldDescription>
                  <FieldError>{emailError}</FieldError>
                </Field>
              </CardContent>
              <CardFooter className="justify-end gap-2">
                <Button
                  variant="ghost"
                  disabled={!emailDirty || isSavingEmail}
                  onClick={() => setNewEmail(user.email)}
                >
                  Cancel
                </Button>
                <Button
                  disabled={!emailDirty || !emailIsValid || isSavingEmail}
                  onClick={requestEmailChange}
                >
                  {isSavingEmail ? (
                    <LoaderIcon
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                  ) : null}
                  Save
                </Button>
              </CardFooter>
            </Card>

            <Card id="authentication" className="scroll-mt-8">
              <CardHeader className="border-b">
                <CardTitle>Authentication</CardTitle>
                <CardDescription>
                  Manage the ways you can sign in to your account.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-hidden rounded-xl border">
                  {context.authMethods.email ? (
                    <div className="flex h-12 items-center gap-4 border-b px-4 text-sm last:border-b-0">
                      <MailIcon className="size-4 shrink-0" />
                      <div className="grid min-w-0 flex-1 grid-cols-[120px_1fr] items-center gap-4">
                        <span className="font-medium">Email</span>
                        <span className="truncate text-muted-foreground">
                          {user.email}
                        </span>
                      </div>
                    </div>
                  ) : null}
                  {socialProviders.map((provider) => {
                    const account = accountsByProvider.get(provider)
                    const accountIdentity = account
                      ? getAccountIdentity(account)
                      : null
                    const isConfigured = context.authMethods[provider]
                    const isConnected = Boolean(account)

                    return (
                      <div
                        className="flex h-12 items-center gap-4 border-b px-4 text-sm last:border-b-0"
                        key={provider}
                      >
                        <ProviderIcon
                          provider={provider}
                          connected={isConnected}
                        />
                        <div
                          className={`grid min-w-0 flex-1 grid-cols-[120px_1fr] items-center gap-4 ${
                            isConnected ? '' : 'text-muted-foreground'
                          }`}
                        >
                          <span className="font-medium capitalize">
                            {provider}
                          </span>
                          <span className="truncate text-muted-foreground">
                            {accountIdentity ?? 'Not connected'}
                          </span>
                        </div>
                        {account ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={busyId === account.id}
                                aria-label={`${provider} options`}
                              >
                                {busyId === account.id ? (
                                  <LoaderIcon className="animate-spin" />
                                ) : (
                                  <EllipsisIcon />
                                )}
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-auto">
                              {account.managementUrl ? (
                                <DropdownMenuItem asChild>
                                  <a
                                    href={account.managementUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="gap-2 whitespace-nowrap"
                                  >
                                    Manage account
                                    <ArrowUpRightIcon className="ml-auto size-3 text-muted-foreground opacity-50" />
                                  </a>
                                </DropdownMenuItem>
                              ) : null}
                              {account.managementUrl ? (
                                <DropdownMenuSeparator />
                              ) : null}
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => setAccountToDisconnect(account)}
                              >
                                Disconnect
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={
                              !isConfigured || pendingProvider === provider
                            }
                            onClick={() => void connectProvider(provider)}
                          >
                            {pendingProvider === provider ? (
                              <LoaderIcon
                                data-icon="inline-start"
                                className="animate-spin"
                              />
                            ) : null}
                            Connect
                          </Button>
                        )}
                      </div>
                    )
                  })}
                </div>
                <AlertDialog
                  open={Boolean(accountToDisconnect)}
                  onOpenChange={(open) => {
                    if (!open) setAccountToDisconnect(null)
                  }}
                >
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Disconnect {accountToDisconnect?.providerId}?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        You will no longer be able to sign in with this provider
                        unless you connect it again.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel
                        disabled={busyId === accountToDisconnect?.id}
                      >
                        Cancel
                      </AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        disabled={busyId === accountToDisconnect?.id}
                        onClick={(event) => {
                          event.preventDefault()
                          if (accountToDisconnect) {
                            void disconnectAccount(accountToDisconnect).then(
                              () => setAccountToDisconnect(null),
                            )
                          }
                        }}
                      >
                        {busyId === accountToDisconnect?.id ? (
                          <LoaderIcon className="animate-spin" />
                        ) : null}
                        Disconnect
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardContent>
            </Card>

            <Card id="teams" className="scroll-mt-8">
              <CardHeader className="border-b">
                <CardTitle>Teams</CardTitle>
                <CardDescription>
                  Manage the teams you are a member of.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-hidden rounded-xl border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead className="w-10">
                          <span className="sr-only">Actions</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {teams.map((team) => (
                        <TableRow key={team.id}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <ResourceAvatar
                                name={team.name}
                                src={team.image ?? undefined}
                                color={team.color}
                                size="sm"
                              />
                              <Link
                                to="/$teamSlug"
                                params={{ teamSlug: team.slug }}
                                className="font-medium"
                              >
                                {team.name}
                              </Link>
                              {team.id === defaultTeam.id ? (
                                <Badge variant="secondary">Default</Badge>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="capitalize text-muted-foreground">
                            {team.role}
                          </TableCell>
                          <TableCell className="text-right">
                            <AlertDialog>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      disabled={
                                        team.isDefault || busyId === team.id
                                      }
                                      aria-label={`Leave ${team.name}`}
                                    >
                                      {busyId === team.id ? (
                                        <LoaderIcon className="animate-spin" />
                                      ) : (
                                        <LogOutIcon />
                                      )}
                                    </Button>
                                  </AlertDialogTrigger>
                                </TooltipTrigger>
                                <TooltipContent>Leave team</TooltipContent>
                              </Tooltip>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    Leave {team.name}?
                                  </AlertDialogTitle>
                                  <AlertDialogDescription>
                                    You will lose access to this team and its
                                    projects.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel
                                    disabled={busyId === team.id}
                                  >
                                    Cancel
                                  </AlertDialogCancel>
                                  <AlertDialogAction
                                    variant="destructive"
                                    disabled={busyId === team.id}
                                    onClick={(event) => {
                                      event.preventDefault()
                                      void leave(team.id)
                                    }}
                                  >
                                    {busyId === team.id ? (
                                      <LoaderIcon className="animate-spin" />
                                    ) : null}
                                    Leave team
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card id="danger" className="scroll-mt-8">
              <CardHeader className="border-b">
                <CardTitle>Danger</CardTitle>
                <CardDescription>
                  Permanently delete your account. Teams where you are the only
                  member are deleted too.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="destructive"
                      disabled={isDeletingAccount}
                      onClick={() => setDeleteAccountConfirmation('')}
                    >
                      {isDeletingAccount ? (
                        <LoaderIcon
                          data-icon="inline-start"
                          className="animate-spin"
                        />
                      ) : (
                        <Trash2Icon data-icon="inline-start" />
                      )}
                      Delete account
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This permanently deletes your account. Teams where you
                        are the only member are deleted too. If you are the only
                        owner of a team with other members, transfer ownership
                        before deleting your account.{' '}
                        {`Type "${user.email}" to confirm.`}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <Field>
                      <Input
                        aria-label={`Type ${user.email} to confirm`}
                        id="delete-account-confirmation"
                        placeholder={user.email}
                        value={deleteAccountConfirmation}
                        onChange={(event) =>
                          setDeleteAccountConfirmation(event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (
                            event.key === 'Enter' &&
                            !isDeletingAccount &&
                            deleteAccountConfirmation === user.email
                          ) {
                            event.preventDefault()
                            void deleteAccount()
                          }
                        }}
                      />
                    </Field>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={isDeletingAccount}>
                        Cancel
                      </AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        disabled={
                          isDeletingAccount ||
                          deleteAccountConfirmation !== user.email
                        }
                        onClick={(event) => {
                          event.preventDefault()
                          void deleteAccount()
                        }}
                      >
                        {isDeletingAccount ? (
                          <LoaderIcon className="animate-spin" />
                        ) : null}
                        Delete account
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </main>
  )
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function getAccountIdentity(account: AuthAccountSummary) {
  return (
    account.providerAccountUsername ??
    account.providerAccountEmail ??
    account.providerAccountName ??
    account.accountId
  )
}

function ProviderIcon({
  connected,
  provider,
}: {
  connected: boolean
  provider: SocialProvider
}) {
  const className = connected
    ? 'size-4 shrink-0'
    : 'size-4 shrink-0 opacity-45 grayscale'

  if (provider === 'github') {
    return <GithubIcon className={className} />
  }

  return <GoogleIcon className={className} />
}

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      role="img"
      fill="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  )
}
