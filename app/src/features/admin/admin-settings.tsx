import { Link, useRouter } from '@tanstack/react-router'
import {
  ArrowLeftIcon,
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
import { SectionNavigation } from '@/components/section-navigation'
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
  const [allowlistValue, setAllowlistValue] = useState('')
  const [importEmails, setImportEmails] = useState('')
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [userPage, setUserPage] = useState(1)
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
    await router.invalidate()
  }

  async function addAllowlistRule() {
    setIsAddingAllowlist(true)

    try {
      await addAllowlistRuleAction({
        data: { type: allowlistType, value: allowlistValue },
      })
      setAllowlistValue('')
      setAllowlistType('email')
      setAddDialogOpen(false)
      toast.success('Allowlist rule added.')
      await refresh()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to add allowlist rule.'))
    } finally {
      setIsAddingAllowlist(false)
    }
  }

  async function importAllowlist() {
    setIsImportingAllowlist(true)

    try {
      await importAllowlistEmailsAction({ data: { emails: importEmails } })
      setImportEmails('')
      setImportDialogOpen(false)
      toast.success('Allowlist emails imported.')
      await refresh()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to import emails.'))
    } finally {
      setIsImportingAllowlist(false)
    }
  }

  async function removeAllowlistRule(id: string) {
    setBusyId(id)

    try {
      await deleteAllowlistRuleAction({ data: { id } })
      toast.success('Allowlist rule deleted.')
      await refresh()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to delete allowlist rule.'))
    } finally {
      setBusyId(null)
    }
  }

  async function banAdminUser(userId: string) {
    setBusyId(userId)

    try {
      await banUserAction({ data: { userId } })
      toast.success('User banned.')
      await refresh()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to ban user.'))
    } finally {
      setBusyId(null)
    }
  }

  async function unbanAdminUser(userId: string) {
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
    setBusyId(userId)

    try {
      await deleteAdminUserAction({ data: { userId } })
      toast.success('User deletion queued.')
      await refresh()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to delete user.'))
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
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add an allowlist rule</DialogTitle>
            <DialogDescription>
              Add a new rule to allow sign up/sign in. You can add email
              addresses (e.g., user@example.com), domains (e.g., example.com) or
              regex patterns (e.g., ^[^@]+@example\.com$).
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="allowlist-value">Rule</FieldLabel>
            <ButtonGroup className="w-full">
              <Select
                value={allowlistType}
                onValueChange={(value) =>
                  setAllowlistType(
                    value === 'domain'
                      ? 'domain'
                      : value === 'pattern'
                        ? 'pattern'
                        : 'email',
                  )
                }
              >
                <SelectTrigger id="allowlist-type" className="w-32 shrink-0">
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
                placeholder={allowlistPlaceholder}
                value={allowlistValue}
                onChange={(event) => setAllowlistValue(event.target.value)}
              />
            </ButtonGroup>
            <FieldDescription>
              Add an email address, a domain, or a regular expression pattern.
            </FieldDescription>
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setAddDialogOpen(false)}
              disabled={isAddingAllowlist}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void addAllowlistRule()}
              disabled={isAddingAllowlist || !allowlistValue.trim()}
            >
              {isAddingAllowlist ? (
                <LoaderIcon data-icon="inline-start" className="animate-spin" />
              ) : null}
              Add rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import email addresses</DialogTitle>
            <DialogDescription>
              Paste email addresses separated by commas, spaces, or new lines.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="allowlist-import-emails">
                Email addresses
              </FieldLabel>
              <Textarea
                id="allowlist-import-emails"
                value={importEmails}
                onChange={(event) => setImportEmails(event.target.value)}
                placeholder="alice@example.com&#10;bob@example.com, carol@example.com"
                rows={5}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setImportDialogOpen(false)}
              disabled={isImportingAllowlist}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void importAllowlist()}
              disabled={isImportingAllowlist || !importEmails.trim()}
            >
              {isImportingAllowlist ? (
                <LoaderIcon data-icon="inline-start" className="animate-spin" />
              ) : null}
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ButtonGroup>
        <Button
          type="button"
          variant="outline"
          onClick={() => setAddDialogOpen(true)}
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
            <DropdownMenuItem onSelect={() => setImportDialogOpen(true)}>
              Bulk import
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>
    </>
  )
  const installation = overview.installation

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-screen-xl space-y-8 p-8">
        <header className="flex items-center gap-x-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild variant="outline" size="icon-sm">
                <Link to="/" aria-label="Back to home">
                  <ArrowLeftIcon />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Back to home</TooltipContent>
          </Tooltip>
          <h1 className="text-2xl font-medium">Admin settings</h1>
        </header>

        <div className="flex flex-row-reverse gap-x-8">
          <SectionNavigation
            className="sticky top-8 hidden h-full min-w-64 lg:flex"
            items={[
              { href: '#installation', label: 'Installation' },
              { href: '#users', label: 'Users' },
              { href: '#allowlist', label: 'Allowlist' },
            ]}
          />

          <div className="w-full min-w-0 flex-1 space-y-8">
            <Card id="installation" className="scroll-mt-8">
              <CardHeader className="border-b">
                <CardTitle>Installation</CardTitle>
                <CardDescription>
                  Information about this installation and available updates.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {installation.current ? (
                  <div className="grid gap-6 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <div className="text-xs text-muted-foreground">
                        Version
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm">
                          {installation.current.gitRef}
                        </span>
                        {installation.latest?.isUpdateAvailable &&
                        installation.latest.url &&
                        installation.latest.tag ? (
                          <Badge
                            asChild
                            variant="secondary"
                            className="bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
                          >
                            <a
                              href={installation.latest.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Update to {installation.latest.tag}
                              <ArrowUpRightIcon />
                            </a>
                          </Badge>
                        ) : installation.latest?.error ? (
                          <Badge variant="outline">Update unavailable</Badge>
                        ) : (
                          <Badge variant="secondary">Latest</Badge>
                        )}
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
                      <div className="text-xs text-muted-foreground">
                        Install ID
                      </div>
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
                  <p className="text-sm text-muted-foreground">
                    No version information found.
                  </p>
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
                      <div className="overflow-hidden rounded-xl border">
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
                                          {displayName
                                            .charAt(0)
                                            .toLocaleUpperCase()}
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
                                              disabled={busyId === user.id}
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
                                        <AlertDialog>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <AlertDialogTrigger asChild>
                                                <Button
                                                  variant="ghost"
                                                  size="icon-sm"
                                                  type="button"
                                                  aria-label="Ban user"
                                                  disabled={busyId === user.id}
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
                                                This signs the user out and
                                                prevents this account from
                                                signing up or signing in again.
                                              </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                              <AlertDialogCancel
                                                disabled={busyId === user.id}
                                              >
                                                Cancel
                                              </AlertDialogCancel>
                                              <AlertDialogAction
                                                variant="destructive"
                                                disabled={busyId === user.id}
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
                                        <AlertDialog>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <AlertDialogTrigger asChild>
                                                <Button
                                                  variant="destructive"
                                                  size="icon-sm"
                                                  type="button"
                                                  aria-label="Remove user"
                                                  disabled={busyId === user.id}
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
                                                account, owned teams, projects,
                                                and deployments that are safe to
                                                delete.
                                              </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                              <AlertDialogCancel
                                                disabled={busyId === user.id}
                                              >
                                                Cancel
                                              </AlertDialogCancel>
                                              <AlertDialogAction
                                                variant="destructive"
                                                disabled={busyId === user.id}
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
                  Control who can sign up and sign in. An empty allowlist means
                  no restrictions.
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
                    <div className="overflow-hidden rounded-xl border">
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
                                <AlertDialog>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <AlertDialogTrigger asChild>
                                        <Button
                                          variant="destructive"
                                          size="icon-sm"
                                          type="button"
                                          aria-label="Remove allowlist rule"
                                          disabled={busyId === entry.id}
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
                                    <AlertDialogFooter>
                                      <AlertDialogCancel
                                        disabled={busyId === entry.id}
                                      >
                                        Cancel
                                      </AlertDialogCancel>
                                      <AlertDialogAction
                                        variant="destructive"
                                        disabled={busyId === entry.id}
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
          </div>
        </div>
      </div>
    </main>
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
