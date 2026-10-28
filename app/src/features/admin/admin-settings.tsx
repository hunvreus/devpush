import {
  allowlistRuleSchema,
  allowlistImportSchema,
} from '#devpush/lib/allowlist-schema'
import { formErrors } from '#devpush/lib/form-errors'
import type { FormErrors } from '#devpush/lib/form-errors'
import { afterMutation } from '#devpush/lib/action-feedback'
import { useRouter } from '@tanstack/react-router'
import {
  BanIcon,
  ChevronDownIcon,
  LoaderIcon,
  PlusIcon,
  SearchIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { TablePager } from '#devpush/components/table-pager'
import { StandaloneSettingsLayout } from '#devpush/components/settings-layout'
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
} from '#devpush/components/ui/alert-dialog'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '#devpush/components/ui/avatar'
import { Badge } from '#devpush/components/ui/badge'
import { Button } from '#devpush/components/ui/button'
import { ButtonGroup } from '#devpush/components/ui/button-group'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#devpush/components/ui/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '#devpush/components/ui/empty'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#devpush/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#devpush/components/ui/dropdown-menu'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '#devpush/components/ui/field'
import { Input } from '#devpush/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '#devpush/components/ui/input-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#devpush/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#devpush/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#devpush/components/ui/tooltip'
import { Textarea } from '#devpush/components/ui/textarea'
import { getErrorMessage } from '#devpush/lib/error-message'
import {
  addAllowlistRuleAction,
  banUserAction,
  deleteAdminUserAction,
  deleteAllowlistRuleAction,
  importAllowlistEmailsAction,
  unbanUserAction,
} from '#devpush/server/admin/functions'
import type { AdminOverview } from '#devpush/server/admin/service'

export function AdminSettings({
  currentUserId,
  overview,
  onSearchChange,
}: {
  currentUserId: string
  overview: AdminOverview
  onSearchChange: (search: {
    allowlistQuery?: string
    allowlistPage?: number
    userQuery?: string
    userPage?: number
  }) => void
}) {
  const router = useRouter()
  const [allowlistQuery, setAllowlistQuery] = useState(
    overview.allowlistPagination.query,
  )
  const allowlistPagination = overview.allowlistPagination
  const [userQuery, setUserQuery] = useState(overview.userPagination.query)
  const [allowlistType, setAllowlistType] = useState<
    'email' | 'domain' | 'pattern'
  >('email')
  const [ruleErrors, setRuleErrors] = useState<FormErrors>({})
  const [importErrors, setImportErrors] = useState<FormErrors>({})
  const [allowlistValue, setAllowlistValue] = useState('')
  const [importEmails, setImportEmails] = useState('')
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [isAddingAllowlist, setIsAddingAllowlist] = useState(false)
  const [isImportingAllowlist, setIsImportingAllowlist] = useState(false)
  const pagedUsers = overview.users
  const { page: userPage, pageCount: userPageCount } = overview.userPagination
  useEffect(() => {
    setUserQuery(overview.userPagination.query)
  }, [overview.userPagination.query])

  useEffect(() => {
    setAllowlistQuery(overview.allowlistPagination.query)
  }, [overview.allowlistPagination.query])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const search: Parameters<typeof onSearchChange>[0] = {}
      if (userQuery !== overview.userPagination.query) {
        search.userQuery = userQuery
        search.userPage = 1
      }
      if (allowlistQuery !== overview.allowlistPagination.query) {
        search.allowlistQuery = allowlistQuery
        search.allowlistPage = 1
      }
      if (Object.keys(search).length) onSearchChange(search)
    }, 300)
    return () => window.clearTimeout(timeout)
  }, [
    userQuery,
    allowlistQuery,
    overview.userPagination.query,
    overview.allowlistPagination.query,
    onSearchChange,
  ])

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
                <FieldLabel htmlFor="allowlist-value">Rule</FieldLabel>
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
                    Email addresses
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
  return (
    <StandaloneSettingsLayout
      title="Admin"
      navigation={[
        { href: '#users', label: 'Users' },
        { href: '#allowlist', label: 'Allowlist' },
      ]}
    >
      <Card id="users" className="scroll-mt-8">
        <CardHeader className="border-b">
          <CardTitle>Users</CardTitle>
          <CardDescription>
            Manage the users registered on your platform.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {overview.userPagination.total === 0 &&
          !overview.userPagination.query ? (
            <Empty className="min-h-40">
              <EmptyHeader>
                <EmptyTitle>No users found.</EmptyTitle>
                <EmptyDescription>
                  {overview.userPagination.query
                    ? 'Try a different name or email.'
                    : 'Registered users will appear here.'}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <InputGroup className="mr-auto max-w-72">
                  <InputGroupAddon>
                    <SearchIcon />
                  </InputGroupAddon>
                  <InputGroupInput
                    aria-label="Search users"
                    placeholder="Search users..."
                    value={userQuery}
                    onChange={(event) => setUserQuery(event.target.value)}
                  />
                </InputGroup>
              </div>
              {overview.users.length === 0 ? (
                <Empty className="min-h-40">
                  <EmptyHeader>
                    <EmptyTitle>No users found.</EmptyTitle>
                    <EmptyDescription>
                      {overview.userPagination.query
                        ? 'Try a different name or email.'
                        : 'Registered users will appear here.'}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <div className="overflow-hidden rounded-xl border bg-card text-card-foreground">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-4">User</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-28 pr-4">
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
                            <TableCell className="pl-4">
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
                            <TableCell className="pr-4 text-right">
                              <div className="ml-auto">
                                <div className="flex items-center justify-end gap-1">
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
                                      <TooltipContent>
                                        Unban user
                                      </TooltipContent>
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
                                              variant="destructive"
                                              size="icon-sm"
                                              type="button"
                                              aria-label="Ban user"
                                              disabled={Boolean(busyId)}
                                            >
                                              <BanIcon />
                                            </Button>
                                          </AlertDialogTrigger>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          Ban user
                                        </TooltipContent>
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
                                      open={
                                        confirmation === `delete:${user.id}`
                                      }
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
                onPageChange={(nextPage) =>
                  onSearchChange({
                    userQuery: overview.userPagination.query,
                    userPage: nextPage,
                  })
                }
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
          {overview.allowlistPagination.total === 0 &&
          !overview.allowlistPagination.query ? (
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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <InputGroup className="max-w-72">
                    <InputGroupAddon>
                      <SearchIcon />
                    </InputGroupAddon>
                    <InputGroupInput
                      aria-label="Search allowlist"
                      placeholder="Search rules..."
                      value={allowlistQuery}
                      onChange={(event) =>
                        setAllowlistQuery(event.target.value)
                      }
                    />
                  </InputGroup>
                </div>
                {allowlistActions}
              </div>
              {overview.allowlist.length === 0 ? (
                <Empty className="min-h-40">
                  <EmptyHeader>
                    <EmptyTitle>No matching allowlist rules.</EmptyTitle>
                    <EmptyDescription>Try a different search.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <div className="overflow-hidden rounded-xl border bg-card text-card-foreground">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-4">Type</TableHead>
                        <TableHead>Value</TableHead>
                        <TableHead>Added</TableHead>
                        <TableHead className="w-16 pr-4">
                          <span className="sr-only">Actions</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {overview.allowlist.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell className="pl-4">
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
                          <TableCell className="pr-4 text-right">
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
                                    This removes {entry.value} from the
                                    allowlist.
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
              )}
              <TablePager
                page={allowlistPagination.page}
                pageCount={allowlistPagination.pageCount}
                onPageChange={(allowlistPage) =>
                  onSearchChange({
                    allowlistQuery: allowlistPagination.query,
                    allowlistPage,
                  })
                }
              />
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
