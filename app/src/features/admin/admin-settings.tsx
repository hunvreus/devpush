import {
  allowlistRuleSchema,
  allowlistImportSchema,
} from '@/lib/allowlist-schema'
import { formErrors } from '@/lib/form-errors'
import type { FormErrors } from '@/lib/form-errors'
import { afterMutation } from '@/lib/action-feedback'
import { useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowUpRightIcon,
  BanIcon,
  ChevronDownIcon,
  CopyIcon,
  LoaderIcon,
  PlusIcon,
  SearchIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  getPageCount,
  getPageItems,
  TablePager,
} from '@/components/table-pager'
import { StandaloneSettingsLayout } from '@/components/settings-layout'
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { Textarea } from '@/components/ui/textarea'
import { getErrorMessage } from '@/lib/error-message'
import {
  addAllowlistRuleAction,
  banUserAction,
  deleteAdminUserAction,
  deleteAllowlistRuleAction,
  getInstallationReleaseStatus,
  importAllowlistEmailsAction,
  unbanUserAction,
} from '@/server/admin/functions'
import type { AdminOverview } from '@/server/admin/service'

export function AdminSettings({
  currentUserId,
  overview,
}: {
  currentUserId: string
  overview: AdminOverview
}) {
  const router = useRouter()
  const [userQuery, setUserQuery] = useState('')
  const [allowlistType, setAllowlistType] = useState<
    'email' | 'domain' | 'pattern'
  >('email')
  const [ruleErrors, setRuleErrors] = useState<FormErrors>({})
  const [importErrors, setImportErrors] = useState<FormErrors>({})
  const [allowlistValue, setAllowlistValue] = useState('')
  const [importEmails, setImportEmails] = useState('')
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [userPage, setUserPage] = useState(1)
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [isAddingAllowlist, setIsAddingAllowlist] = useState(false)
  const [isImportingAllowlist, setIsImportingAllowlist] = useState(false)
  const filteredUsers = useMemo(() => {
    const query = userQuery.trim().toLowerCase()
    if (!query) return overview.users

    return overview.users.filter((user) =>
      [user.name, user.username, user.email, user.status]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query)),
    )
  }, [overview.users, userQuery])
  const userPageCount = getPageCount(filteredUsers.length)
  const pagedUsers = useMemo(
    () => getPageItems(filteredUsers, userPage),
    [filteredUsers, userPage],
  )

  useEffect(() => {
    setUserPage(1)
  }, [userQuery])

  useEffect(() => {
    if (userPage > userPageCount) {
      setUserPage(userPageCount)
    }
  }, [userPage, userPageCount])

  async function refresh() {
    await afterMutation(
      () => router.invalidate(),
      'The action completed, but refreshing the page failed. Please reload.',
    )
  }

  async function addAllowlistRule() {
    if (isAddingAllowlist) return
    const parsed = allowlistRuleSchema.safeParse({
      type: allowlistType,
      value: allowlistValue,
    })
    if (!parsed.success) {
      setRuleErrors(formErrors(parsed.error.issues))
      document.getElementById('allowlist-value')?.focus()
      return
    }
    setRuleErrors({})
    setIsAddingAllowlist(true)

    try {
      const result = await addAllowlistRuleAction({ data: parsed.data })
      if (result.fieldErrors) {
        setRuleErrors(result.fieldErrors)
        return
      }
      setAllowlistValue('')
      setAllowlistType('email')
      setAddDialogOpen(false)
      toast.success('Allowlist rule added.')
      await refresh()
    } catch (error) {
      setRuleErrors({
        form: getErrorMessage(
          error,
          'Unable to add allowlist rule. Please try again.',
        ),
      })
    } finally {
      setIsAddingAllowlist(false)
    }
  }

  async function importAllowlist() {
    if (isImportingAllowlist) return
    const parsed = allowlistImportSchema.safeParse({ emails: importEmails })
    if (!parsed.success) {
      setImportErrors(formErrors(parsed.error.issues))
      document.getElementById('allowlist-import-emails')?.focus()
      return
    }
    setImportErrors({})
    setIsImportingAllowlist(true)

    try {
      const result = await importAllowlistEmailsAction({ data: parsed.data })
      if (result.fieldErrors) {
        setImportErrors(result.fieldErrors)
        return
      }
      setImportEmails('')
      setImportDialogOpen(false)
      toast.success('Allowlist emails imported.')
      await refresh()
    } catch (error) {
      setImportErrors({
        form: getErrorMessage(
          error,
          'Unable to import emails. Please try again.',
        ),
      })
    } finally {
      setIsImportingAllowlist(false)
    }
  }

  async function removeAllowlistRule(id: string) {
    if (busyId) return
    setActionError(null)
    setBusyId(id)

    try {
      await deleteAllowlistRuleAction({ data: { id } })
      setConfirmation(null)
      toast.success('Allowlist rule deleted.')
      await refresh()
    } catch (error) {
      setActionError(getErrorMessage(error, 'Unable to delete allowlist rule.'))
    } finally {
      setBusyId(null)
    }
  }

  async function banAdminUser(userId: string) {
    if (busyId) return
    setActionError(null)
    setBusyId(userId)

    try {
      await banUserAction({ data: { userId } })
      setConfirmation(null)
      toast.success('User banned.')
      await refresh()
    } catch (error) {
      setActionError(getErrorMessage(error, 'Unable to ban user.'))
    } finally {
      setBusyId(null)
    }
  }

  async function unbanAdminUser(userId: string) {
    if (busyId) return
    setActionError(null)
    setBusyId(userId)

    try {
      await unbanUserAction({ data: { userId } })
      toast.success('User unbanned.')
      await refresh()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to unban user.'))
    } finally {
      setBusyId(null)
    }
  }

  async function deleteUser(userId: string) {
    if (busyId) return
    setActionError(null)
    setBusyId(userId)

    try {
      await deleteAdminUserAction({ data: { userId } })
      setConfirmation(null)
      toast.success('User deletion queued.')
      await refresh()
    } catch (error) {
      setActionError(getErrorMessage(error, 'Unable to delete user.'))
    } finally {
      setBusyId(null)
    }
  }

  async function copyInstallId(installId: string) {
    try {
      await navigator.clipboard.writeText(installId)
      toast.success('Install ID copied.')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to copy install ID.'))
    }
  }

  const allowlistPlaceholder =
    allowlistType === 'domain'
      ? 'example.com'
      : allowlistType === 'pattern'
        ? String.raw`^[^@]+@example\.com$`
        : 'user@example.com'

  const allowlistActions = (
    <>
      <Dialog
        open={addDialogOpen}
        onOpenChange={(open) => {
          if (!isAddingAllowlist) setAddDialogOpen(open)
        }}
      >
        <DialogContent>
          <form
            id="allowlist-rule-form"
            className="grid gap-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              void addAllowlistRule()
            }}
          >
            <fieldset disabled={isAddingAllowlist} className="grid gap-4">
              <DialogHeader>
                <DialogTitle>Add an allowlist rule</DialogTitle>
                <DialogDescription>
                  Add a new rule to allow sign up/sign in. You can add email
                  addresses (e.g., user@example.com), domains (e.g.,
                  example.com) or regex patterns (e.g., ^[^@]+@example\.com$).
                </DialogDescription>
              </DialogHeader>
              <Field>
                <FieldLabel htmlFor="allowlist-value">
                  Rule (required)
                </FieldLabel>
                <ButtonGroup className="w-full">
                  <Select
                    value={allowlistType}
                    onValueChange={(value) => {
                      setRuleErrors({})
                      setAllowlistType(
                        value === 'domain'
                          ? 'domain'
                          : value === 'pattern'
                            ? 'pattern'
                            : 'email',
                      )
                    }}
                  >
                    <SelectTrigger
                      id="allowlist-type"
                      aria-invalid={Boolean(ruleErrors.type)}
                      aria-describedby="allowlist-value-error"
                      className="w-32 shrink-0"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="email">Email</SelectItem>
                      <SelectItem value="domain">Domain</SelectItem>
                      <SelectItem value="pattern">Pattern</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    id="allowlist-value"
                    required
                    maxLength={255}
                    aria-invalid={Boolean(ruleErrors.value)}
                    aria-describedby="allowlist-value-error"
                    placeholder={allowlistPlaceholder}
                    value={allowlistValue}
                    onChange={(event) => {
                      setAllowlistValue(event.target.value)
                      setRuleErrors({})
                    }}
                  />
                </ButtonGroup>
                <FieldError id="allowlist-value-error">
                  {ruleErrors.value ?? ruleErrors.type}
                </FieldError>
                <FieldDescription>
                  Add an email address, a domain, or a regular expression
                  pattern.
                </FieldDescription>
              </Field>
              <FieldError role="alert">{ruleErrors.form}</FieldError>
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setAddDialogOpen(false)}
                  disabled={isAddingAllowlist}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isAddingAllowlist}>
                  {isAddingAllowlist ? (
                    <LoaderIcon
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                  ) : null}
                  Add rule
                </Button>
              </DialogFooter>
            </fieldset>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={importDialogOpen}
        onOpenChange={(open) => {
          if (!isImportingAllowlist) setImportDialogOpen(open)
        }}
      >
        <DialogContent>
          <form
            id="allowlist-import-form"
            className="grid gap-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              void importAllowlist()
            }}
          >
            <fieldset disabled={isImportingAllowlist} className="grid gap-4">
              <DialogHeader>
                <DialogTitle>Import email addresses</DialogTitle>
                <DialogDescription>
                  Paste email addresses separated by commas, spaces, or new
                  lines.
                </DialogDescription>
              </DialogHeader>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="allowlist-import-emails">
                    Email addresses (required)
                  </FieldLabel>
                  <Textarea
                    id="allowlist-import-emails"
                    required
                    maxLength={20000}
                    aria-invalid={Boolean(importErrors.emails)}
                    aria-describedby="allowlist-import-error"
                    value={importEmails}
                    onChange={(event) => {
                      setImportEmails(event.target.value)
                      setImportErrors({})
                    }}
                    placeholder="alice@example.com&#10;bob@example.com, carol@example.com"
                    rows={5}
                  />
                  <FieldError id="allowlist-import-error">
                    {importErrors.emails}
                  </FieldError>
                </Field>
              </FieldGroup>
              <FieldError role="alert">{importErrors.form}</FieldError>
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setImportDialogOpen(false)}
                  disabled={isImportingAllowlist}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isImportingAllowlist}>
                  {isImportingAllowlist ? (
                    <LoaderIcon
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                  ) : null}
                  Import
                </Button>
              </DialogFooter>
            </fieldset>
          </form>
        </DialogContent>
      </Dialog>
      <ButtonGroup>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setRuleErrors({})
            setAddDialogOpen(true)
          }}
        >
          <PlusIcon data-icon="inline-start" />
          Add rule
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="More allowlist actions"
            >
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => {
                setImportErrors({})
                setImportDialogOpen(true)
              }}
            >
              Bulk import
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>
    </>
  )
  const installation = overview.installation
  const { data: latestInstallation, error: releaseError } = useQuery({
    queryKey: ['installation-release-status'],
    queryFn: () => getInstallationReleaseStatus(),
    enabled: Boolean(installation.current),
    staleTime: 5 * 60 * 1000,
  })
  const latest = latestInstallation ?? installation.latest

  return (
    <StandaloneSettingsLayout
      title="Admin settings"
      navigation={[
        { href: '#installation', label: 'Installation' },
        { href: '#users', label: 'Users' },
        { href: '#allowlist', label: 'Allowlist' },
      ]}
    >
      <Card id="installation" className="scroll-mt-8">
        <CardHeader className="border-b">
          <CardTitle>Installation</CardTitle>
          <CardDescription>
            Information about this installation and available updates.
          </CardDescription>
        </CardHeader>
        <CardContent className="min-h-40">
          {installation.current ? (
            <div className="grid gap-6 sm:grid-cols-3">
              <div className="space-y-1.5">
                <div className="text-xs text-muted-foreground">Version</div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">
                    {installation.current.gitRef}
                  </span>
                  {!releaseError &&
                  latest?.isUpdateAvailable &&
                  latest.url &&
                  latest.tag ? (
                    <Badge
                      asChild
                      variant="secondary"
                      className="bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
                    >
                      <a href={latest.url} target="_blank" rel="noreferrer">
                        Update to {latest.tag}
                        <ArrowUpRightIcon />
                      </a>
                    </Badge>
                  ) : releaseError || latest?.error ? (
                    <Badge variant="outline">Update unavailable</Badge>
                  ) : latest ? (
                    <Badge variant="secondary">Latest</Badge>
                  ) : null}
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="text-xs text-muted-foreground">
                  Last updated
                </div>
                <div className="text-sm">
                  {installation.current.updatedAt
                    ? formatAge(installation.current.updatedAt)
                    : '-'}
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="text-xs text-muted-foreground">Install ID</div>
                {installation.current.installId ? (
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-sm">
                      {installation.current.installId}
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Copy install ID"
                          onClick={() =>
                            void copyInstallId(
                              installation.current?.installId ?? '',
                            )
                          }
                        >
                          <CopyIcon />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Copy install ID</TooltipContent>
                    </Tooltip>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">-</div>
                )}
              </div>
            </div>
          ) : (
            <Empty className="min-h-40">
              <EmptyHeader>
                <EmptyTitle>No installation information</EmptyTitle>
                <EmptyDescription>
                  If you are not running a development version, check the
                  installation and version-file configuration.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>

      <Card id="users" className="scroll-mt-8">
        <CardHeader className="border-b">
          <CardTitle>Users</CardTitle>
          <CardDescription>
            Manage the users registered on your platform.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {overview.users.length === 0 ? (
            <p className="flex h-24 items-center justify-center text-sm text-muted-foreground">
              No users found.
            </p>
          ) : (
            <>
              <InputGroup className="mr-auto max-w-72">
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
                <InputGroupInput
                  placeholder="Search..."
                  value={userQuery}
                  onChange={(event) => setUserQuery(event.target.value)}
                />
              </InputGroup>
              {filteredUsers.length === 0 ? (
                <p className="flex h-24 items-center justify-center text-sm text-muted-foreground">
                  No users found.
                </p>
              ) : (
                <div className="overflow-hidden rounded-xl border bg-card text-card-foreground">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-28">
                          <span className="sr-only">Actions</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedUsers.map((user) => {
                        const displayName = user.name || user.email
                        const isCurrentUser = user.id === currentUserId

                        return (
                          <TableRow key={user.id}>
                            <TableCell>
                              <div className="flex min-w-0 items-center gap-3">
                                <Avatar className="size-8">
                                  <AvatarImage
                                    src={user.image ?? undefined}
                                    alt={displayName}
                                  />
                                  <AvatarFallback>
                                    {displayName.charAt(0).toLocaleUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="min-w-0">
                                  <div className="truncate font-medium">
                                    {displayName}
                                  </div>
                                  {user.username ? (
                                    <div className="truncate text-xs text-muted-foreground">
                                      {user.username}
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="truncate text-muted-foreground">
                              {user.email}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatAge(user.createdAt)}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  user.status === 'active'
                                    ? 'secondary'
                                    : 'outline'
                                }
                              >
                                {formatUserStatus(user)}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="ml-auto flex items-center justify-end gap-1">
                                {isCurrentUser ||
                                user.status ===
                                  'deleted' ? null : user.status ===
                                  'banned' ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        type="button"
                                        aria-label="Unban user"
                                        disabled={Boolean(busyId)}
                                        onClick={() =>
                                          void unbanAdminUser(user.id)
                                        }
                                      >
                                        {busyId === user.id ? (
                                          <LoaderIcon className="animate-spin" />
                                        ) : (
                                          <ShieldCheckIcon />
                                        )}
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Unban user</TooltipContent>
                                  </Tooltip>
                                ) : (
                                  <AlertDialog
                                    open={confirmation === `ban:${user.id}`}
                                    onOpenChange={(open) => {
                                      if (!busyId) {
                                        setActionError(null)
                                        setConfirmation(
                                          open ? `ban:${user.id}` : null,
                                        )
                                      }
                                    }}
                                  >
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <AlertDialogTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="icon-sm"
                                            type="button"
                                            aria-label="Ban user"
                                            disabled={Boolean(busyId)}
                                          >
                                            <BanIcon />
                                          </Button>
                                        </AlertDialogTrigger>
                                      </TooltipTrigger>
                                      <TooltipContent>Ban user</TooltipContent>
                                    </Tooltip>
                                    <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>
                                          Ban {displayName}?
                                        </AlertDialogTitle>
                                        <AlertDialogDescription>
                                          This signs the user out and prevents
                                          this account from signing up or
                                          signing in again.
                                        </AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <FieldError role="alert">
                                        {actionError}
                                      </FieldError>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel
                                          disabled={Boolean(busyId)}
                                        >
                                          Cancel
                                        </AlertDialogCancel>
                                        <AlertDialogAction
                                          variant="destructive"
                                          disabled={Boolean(busyId)}
                                          onClick={(event) => {
                                            event.preventDefault()
                                            void banAdminUser(user.id)
                                          }}
                                        >
                                          {busyId === user.id ? (
                                            <LoaderIcon className="animate-spin" />
                                          ) : null}
                                          Ban user
                                        </AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                )}
                                {isCurrentUser ||
                                user.status !== 'active' ? null : (
                                  <AlertDialog
                                    open={confirmation === `delete:${user.id}`}
                                    onOpenChange={(open) => {
                                      if (!busyId) {
                                        setActionError(null)
                                        setConfirmation(
                                          open ? `delete:${user.id}` : null,
                                        )
                                      }
                                    }}
                                  >
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <AlertDialogTrigger asChild>
                                          <Button
                                            variant="destructive"
                                            size="icon-sm"
                                            type="button"
                                            aria-label="Remove user"
                                            disabled={Boolean(busyId)}
                                          >
                                            <Trash2Icon />
                                          </Button>
                                        </AlertDialogTrigger>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        Remove user
                                      </TooltipContent>
                                    </Tooltip>
                                    <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>
                                          Delete {displayName}?
                                        </AlertDialogTitle>
                                        <AlertDialogDescription>
                                          This queues deletion of the user
                                          account, owned teams, projects, and
                                          deployments that are safe to delete.
                                        </AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <FieldError role="alert">
                                        {actionError}
                                      </FieldError>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel
                                          disabled={Boolean(busyId)}
                                        >
                                          Cancel
                                        </AlertDialogCancel>
                                        <AlertDialogAction
                                          variant="destructive"
                                          disabled={Boolean(busyId)}
                                          onClick={(event) => {
                                            event.preventDefault()
                                            void deleteUser(user.id)
                                          }}
                                        >
                                          {busyId === user.id ? (
                                            <LoaderIcon className="animate-spin" />
                                          ) : null}
                                          Delete user
                                        </AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
              <TablePager
                page={userPage}
                pageCount={userPageCount}
                onPageChange={setUserPage}
              />
            </>
          )}
        </CardContent>
      </Card>

      <Card id="allowlist" className="scroll-mt-8">
        <CardHeader className="border-b">
          <CardTitle>Allowlist</CardTitle>
          <CardDescription>
            Control who can sign up and sign in. An empty allowlist means no
            restrictions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {overview.allowlist.length === 0 ? (
            <Empty className="min-h-40">
              <EmptyHeader>
                <EmptyTitle>No allowlist entries.</EmptyTitle>
                <EmptyDescription>
                  Add a rule to restrict who can sign up and sign in.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>{allowlistActions}</EmptyContent>
            </Empty>
          ) : (
            <>
              <div className="flex justify-end">{allowlistActions}</div>
              <div className="overflow-hidden rounded-xl border bg-card text-card-foreground">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead>Added</TableHead>
                      <TableHead className="w-16">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.allowlist.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>
                          <Badge variant="secondary">
                            {formatAllowlistType(entry.type)}
                          </Badge>
                        </TableCell>
                        <TableCell className="truncate font-medium">
                          {entry.value}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatAge(entry.createdAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          <AlertDialog
                            open={confirmation === `rule:${entry.id}`}
                            onOpenChange={(open) => {
                              if (!busyId) {
                                setActionError(null)
                                setConfirmation(
                                  open ? `rule:${entry.id}` : null,
                                )
                              }
                            }}
                          >
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="destructive"
                                    size="icon-sm"
                                    type="button"
                                    aria-label="Remove allowlist rule"
                                    disabled={Boolean(busyId)}
                                  >
                                    <Trash2Icon />
                                  </Button>
                                </AlertDialogTrigger>
                              </TooltipTrigger>
                              <TooltipContent>
                                Remove allowlist rule
                              </TooltipContent>
                            </Tooltip>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  Delete allowlist rule?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  This removes {entry.value} from the allowlist.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <FieldError role="alert">
                                {actionError}
                              </FieldError>
                              <AlertDialogFooter>
                                <AlertDialogCancel disabled={Boolean(busyId)}>
                                  Cancel
                                </AlertDialogCancel>
                                <AlertDialogAction
                                  variant="destructive"
                                  disabled={Boolean(busyId)}
                                  onClick={(event) => {
                                    event.preventDefault()
                                    void removeAllowlistRule(entry.id)
                                  }}
                                >
                                  {busyId === entry.id ? (
                                    <LoaderIcon className="animate-spin" />
                                  ) : null}
                                  Delete rule
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
            </>
          )}
        </CardContent>
      </Card>
    </StandaloneSettingsLayout>
  )
}

function formatUserStatus(user: AdminOverview['users'][number]) {
  if (user.status === 'deleted') {
    return 'Deleted'
  }

  if (user.status === 'banned') {
    return 'Banned'
  }

  return user.emailVerified ? 'Verified' : 'Active'
}

function formatAllowlistType(
  value: AdminOverview['allowlist'][number]['type'],
) {
  if (value === 'domain') {
    return 'Domain'
  }

  if (value === 'pattern') {
    return 'Pattern'
  }

  return 'Email'
}

function formatAge(value: string) {
  const date = new Date(value)
  const diffMs = Date.now() - date.getTime()
  const diffDays = Math.round(diffMs / 86_400_000)

  if (diffDays < 1) {
    return 'today'
  }

  if (diffDays === 1) {
    return 'yesterday'
  }

  return `${diffDays} days ago`
}
