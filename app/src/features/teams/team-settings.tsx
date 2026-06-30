import { Link, useRouter } from '@tanstack/react-router'
import {
  ChevronDownIcon,
  CopyIcon,
  InfoIcon,
  LoaderIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
  UserRoundCheckIcon,
  UploadIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'

import {
  getPageCount,
  getPageItems,
  TablePager,
} from '@/components/table-pager'
import { Alert, AlertTitle } from '@/components/ui/alert'
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
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { Field, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
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
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ResourceAvatar } from '@/components/resource-avatar'
import {
  canDeleteTeam as canDeleteTeamByRole,
  canManageTeamMembers,
} from '@/lib/team-role'
import type { TeamRole } from '@/lib/team-role'
import { getErrorMessage } from '@/lib/error-message'
import { isValidEmail } from '@/lib/validation'
import {
  createTeamInviteAction,
  createTeamInvitesAction,
  deleteTeamAction,
  removeTeamMemberAction,
  resendTeamInviteAction,
  revokeTeamInviteAction,
  transferTeamOwnershipAction,
  updateTeamGeneralAction,
  updateTeamMemberRoleAction,
} from '@/server/teams/functions'
import type {
  TeamInviteSummary,
  TeamMemberSummary,
  TeamSummary,
} from '@/server/teams/service'

export function TeamSettings({
  canDeleteTeam,
  currentUserId,
  isDefaultTeam,
  invites,
  members,
  team,
}: {
  canDeleteTeam: boolean
  currentUserId: string
  isDefaultTeam: boolean
  invites: Array<TeamInviteSummary>
  members: Array<TeamMemberSummary>
  team: TeamSummary
}) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(team.name)
  const [slug, setSlug] = useState(team.slug)
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null)
  const [deleteAvatar, setDeleteAvatar] = useState(false)
  const [isSavingGeneral, setIsSavingGeneral] = useState(false)
  const [memberQuery, setMemberQuery] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member')
  const [inviteAttempted, setInviteAttempted] = useState(false)
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false)
  const [bulkInviteEmails, setBulkInviteEmails] = useState('')
  const [bulkInviteRole, setBulkInviteRole] = useState<'admin' | 'member'>(
    'member',
  )
  const [bulkInviteDialogOpen, setBulkInviteDialogOpen] = useState(false)
  const [memberPage, setMemberPage] = useState(1)
  const [isInviting, setIsInviting] = useState(false)
  const [isBulkInviting, setIsBulkInviting] = useState(false)
  const [isDeletingTeam, setIsDeletingTeam] = useState(false)
  const [deleteTeamConfirmation, setDeleteTeamConfirmation] = useState('')
  const [removeMemberConfirmation, setRemoveMemberConfirmation] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pendingRoleChange, setPendingRoleChange] = useState<{
    member: TeamMemberSummary
    role: TeamRole
  } | null>(null)
  const [pendingOwnershipTransfer, setPendingOwnershipTransfer] =
    useState<TeamMemberSummary | null>(null)
  const canManageMembers = canManageTeamMembers(team.role)
  const canManageOwners = team.role === 'owner'
  const ownerCount = members.filter((member) => member.role === 'owner').length
  const filteredMembers = useMemo(() => {
    const query = memberQuery.trim().toLowerCase()
    if (!query) return members

    return members.filter((member) =>
      [member.user.name, member.user.username, member.user.email, member.role]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query)),
    )
  }, [members, memberQuery])
  const memberPageCount = getPageCount(filteredMembers.length)
  const pagedMembers = useMemo(
    () => getPageItems(filteredMembers, memberPage),
    [filteredMembers, memberPage],
  )
  const normalizedInviteEmail = inviteEmail.trim()
  const inviteEmailIsValid = isValidEmail(normalizedInviteEmail)
  const inviteEmailError =
    inviteAttempted && !inviteEmailIsValid
      ? normalizedInviteEmail
        ? 'Enter a valid email address.'
        : 'Email is required.'
      : null

  const avatarUrl = deleteAvatar ? null : (avatarDataUrl ?? team.image)
  const generalDirty =
    name.trim() !== team.name ||
    slug.trim() !== team.slug ||
    Boolean(avatarDataUrl) ||
    deleteAvatar

  function resetGeneral() {
    setName(team.name)
    setSlug(team.slug)
    setAvatarDataUrl(null)
    setDeleteAvatar(false)
  }

  useEffect(() => {
    if (memberPage > memberPageCount) {
      setMemberPage(memberPageCount)
    }
  }, [memberPage, memberPageCount])

  useEffect(() => {
    setMemberPage(1)
  }, [memberQuery])

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
      const nextTeam = await updateTeamGeneralAction({
        data: {
          teamSlug: team.slug,
          name,
          slug,
          avatarDataUrl,
          deleteAvatar,
        },
      })
      setAvatarDataUrl(null)
      setDeleteAvatar(false)
      toast.success('Team settings saved.')
      if (nextTeam.slug !== team.slug) {
        await router.navigate({
          to: '/$teamSlug/settings',
          params: { teamSlug: nextTeam.slug },
        })
      } else {
        await router.invalidate()
      }
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to save team.'))
    } finally {
      setIsSavingGeneral(false)
    }
  }

  async function sendInvite() {
    setInviteAttempted(true)
    const email = inviteEmail.trim()
    if (!isValidEmail(email)) {
      return
    }

    setIsInviting(true)

    try {
      const result = await createTeamInviteAction({
        data: {
          teamSlug: team.slug,
          email,
          role: inviteRole,
        },
      })
      setInviteEmail('')
      setInviteRole('member')
      setInviteAttempted(false)
      setInviteDialogOpen(false)
      await handleInviteResult(result, 'Invite sent.')
      await router.invalidate()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to send invite.'))
    } finally {
      setIsInviting(false)
    }
  }

  async function sendBulkInvites() {
    if (!bulkInviteEmails.trim()) {
      toast.error('Enter at least one email address.')
      return
    }

    setIsBulkInviting(true)

    try {
      const result = await createTeamInvitesAction({
        data: {
          teamSlug: team.slug,
          emails: bulkInviteEmails,
          role: bulkInviteRole,
        },
      })
      setBulkInviteEmails('')
      setBulkInviteRole('member')
      setBulkInviteDialogOpen(false)
      if (result.emailSentCount === result.emailCount) {
        toast.success(
          result.emailCount === 1
            ? 'Invite sent.'
            : `${result.emailCount} invites sent.`,
        )
      } else {
        toast.warning(
          `${result.emailCount} invites created, ${result.emailSentCount} emails sent.`,
        )
      }
      await router.invalidate()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to send invites.'))
    } finally {
      setIsBulkInviting(false)
    }
  }

  async function updateRole(memberUserId: string, role: TeamRole) {
    setBusyId(memberUserId)

    try {
      await updateTeamMemberRoleAction({
        data: { teamSlug: team.slug, memberUserId, role },
      })
      toast.success('Member role updated.')
      await router.invalidate()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to update member.'))
    } finally {
      setBusyId(null)
    }
  }

  async function removeMember(memberUserId: string) {
    setBusyId(memberUserId)

    try {
      await removeTeamMemberAction({
        data: { teamSlug: team.slug, memberUserId },
      })
      toast.success('Member removed.')
      await router.invalidate()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to remove member.'))
    } finally {
      setBusyId(null)
    }
  }

  async function transferOwnership(memberUserId: string) {
    setBusyId(memberUserId)

    try {
      await transferTeamOwnershipAction({
        data: { teamSlug: team.slug, memberUserId },
      })
      setPendingOwnershipTransfer(null)
      toast.success('Ownership transferred.')
      await router.invalidate()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to transfer ownership.'))
    } finally {
      setBusyId(null)
    }
  }

  async function resendInvite(inviteId: string) {
    setBusyId(inviteId)

    try {
      const result = await resendTeamInviteAction({
        data: { teamSlug: team.slug, inviteId },
      })
      await handleInviteResult(result, 'Invite resent.')
      await router.invalidate()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to resend invite.'))
    } finally {
      setBusyId(null)
    }
  }

  async function handleInviteResult(
    result: { emailSent: boolean; inviteUrl: string },
    successMessage: string,
  ) {
    if (result.emailSent) {
      toast.success(successMessage)
      return
    }

    await navigator.clipboard.writeText(result.inviteUrl).catch(() => {})
    toast.warning('Invite created, but email failed. Invite link copied.')
  }

  async function revokeInvite(inviteId: string) {
    setBusyId(inviteId)

    try {
      await revokeTeamInviteAction({ data: { teamSlug: team.slug, inviteId } })
      toast.success('Invite revoked.')
      await router.invalidate()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to revoke invite.'))
    } finally {
      setBusyId(null)
    }
  }

  async function deleteCurrentTeam() {
    setIsDeletingTeam(true)

    try {
      await deleteTeamAction({
        data: {
          teamSlug: team.slug,
          confirmationName: deleteTeamConfirmation,
        },
      })
      toast.success('Team deleted.')
      await router.navigate({ to: '/' })
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to delete team.'))
    } finally {
      setIsDeletingTeam(false)
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_240px]">
      <div className="space-y-8">
        <h1 className="flex items-center gap-x-3 text-2xl font-medium">
          <Link to="/$teamSlug" params={{ teamSlug: team.slug }}>
            <ResourceAvatar
              name={team.name}
              src={team.image ?? undefined}
              color={team.color}
              size="md"
            />
          </Link>
          <span className="text-muted-foreground/25 font-normal">/</span>
          <span>Team settings</span>
        </h1>

        <SettingsSection
          id="general"
          title="General"
          description="General settings for the team."
          footer={
            <SettingsActions
              disabled={!generalDirty || isSavingGeneral}
              isSaving={isSavingGeneral}
              onCancel={resetGeneral}
              onSave={saveGeneral}
            />
          }
        >
          <div className="space-y-8">
            <div className="space-y-3">
              <Label>Avatar</Label>
              <div className="flex items-center gap-x-2">
                <ResourceAvatar
                  name={name}
                  src={avatarUrl ?? undefined}
                  color={team.color}
                  size="md"
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
                  <UploadIcon />
                  Upload image
                </Button>
                {avatarUrl ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        type="button"
                        aria-label="Remove image"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20"
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
            </div>

            <div className="space-y-3">
              <Label htmlFor="team-name">Display name</Label>
              <Input
                id="team-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            <div className="space-y-3">
              <Label htmlFor="team-slug">Slug</Label>
              <Input
                id="team-slug"
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
              />
            </div>

            <div className="space-y-3">
              <Label htmlFor="team-id">Team ID</Label>
              <InputGroup>
                <InputGroupInput
                  id="team-id"
                  className="font-mono text-[13px] text-muted-foreground"
                  value={team.id}
                  readOnly
                />
                <InputGroupAddon align="inline-end">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <InputGroupButton
                        size="icon-sm"
                        type="button"
                        aria-label="Copy team ID"
                        onClick={() =>
                          void navigator.clipboard.writeText(team.id)
                        }
                      >
                        <CopyIcon />
                      </InputGroupButton>
                    </TooltipTrigger>
                    <TooltipContent>Copy team ID</TooltipContent>
                  </Tooltip>
                </InputGroupAddon>
              </InputGroup>
              <p className="text-sm text-muted-foreground">
                A unique identifier used in API, environment variables, etc.
              </p>
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          id="members"
          title="Members"
          description="Manage the members of the team."
        >
          <div className="space-y-6">
            <div className="space-y-4">
              <Dialog
                open={inviteDialogOpen}
                onOpenChange={setInviteDialogOpen}
              >
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add member</DialogTitle>
                    <DialogDescription>
                      Invite a member to join this team.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <Field data-invalid={Boolean(inviteEmailError)}>
                      <Label htmlFor="invite-email">Email</Label>
                      <Input
                        id="invite-email"
                        type="email"
                        placeholder="name@example.com"
                        value={inviteEmail}
                        aria-invalid={Boolean(inviteEmailError)}
                        onChange={(event) => {
                          setInviteEmail(event.target.value)
                          if (inviteAttempted) {
                            setInviteAttempted(false)
                          }
                        }}
                      />
                      <FieldError>{inviteEmailError}</FieldError>
                    </Field>
                    <div className="space-y-2">
                      <Label htmlFor="invite-role">Role</Label>
                      <Select
                        value={inviteRole}
                        onValueChange={(value) =>
                          setInviteRole(value === 'admin' ? 'admin' : 'member')
                        }
                      >
                        <SelectTrigger id="invite-role">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="member">Member</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setInviteDialogOpen(false)}
                      disabled={isInviting}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      onClick={sendInvite}
                      disabled={isInviting}
                    >
                      Invite
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Dialog
                open={bulkInviteDialogOpen}
                onOpenChange={setBulkInviteDialogOpen}
              >
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Bulk invite members</DialogTitle>
                    <DialogDescription>
                      Paste email addresses separated by commas, spaces, or new
                      lines. Each invite will use the selected role.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="bulk-invite-role">Role</Label>
                      <Select
                        value={bulkInviteRole}
                        onValueChange={(value) =>
                          setBulkInviteRole(
                            value === 'admin' ? 'admin' : 'member',
                          )
                        }
                      >
                        <SelectTrigger id="bulk-invite-role">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="member">Member</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bulk-invite-emails">
                        Email addresses
                      </Label>
                      <Textarea
                        id="bulk-invite-emails"
                        value={bulkInviteEmails}
                        onChange={(event) =>
                          setBulkInviteEmails(event.target.value)
                        }
                        placeholder="alice@example.com&#10;bob@example.com, carol@example.com"
                        rows={5}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setBulkInviteDialogOpen(false)}
                      disabled={isBulkInviting}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      onClick={sendBulkInvites}
                      disabled={isBulkInviting || !bulkInviteEmails.trim()}
                    >
                      {isBulkInviting ? (
                        <LoaderIcon className="animate-spin" />
                      ) : null}
                      Invite members
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <div className="flex items-center justify-between gap-2">
                <InputGroup className="h-8 max-w-72">
                  <InputGroupAddon>
                    <SearchIcon />
                  </InputGroupAddon>
                  <InputGroupInput
                    placeholder="Search..."
                    value={memberQuery}
                    onChange={(event) => setMemberQuery(event.target.value)}
                  />
                </InputGroup>
                <ButtonGroup>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setInviteDialogOpen(true)}
                  >
                    <PlusIcon />
                    Add member
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        aria-label="More member actions"
                      >
                        <ChevronDownIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => setBulkInviteDialogOpen(true)}
                      >
                        Bulk invite
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </ButtonGroup>
              </div>

              {filteredMembers.length === 0 ? (
                <p className="flex h-24 items-center justify-center text-sm text-muted-foreground">
                  No members found.
                </p>
              ) : (
                <div className="overflow-hidden rounded-xl border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead className="w-[120px]">Role</TableHead>
                        <TableHead className="w-28">
                          <span className="sr-only">Actions</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedMembers.map((member) => {
                        const displayName =
                          member.user.name || member.user.email.split('@')[0]
                        const isLastOwner =
                          member.role === 'owner' && ownerCount <= 1
                        const canManageMember =
                          canManageMembers &&
                          (canManageOwners || member.role !== 'owner')
                        const canTransferToMember =
                          canManageOwners &&
                          member.user.id !== currentUserId &&
                          member.role !== 'owner'

                        return (
                          <TableRow key={member.id}>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <Avatar className="size-8">
                                  <AvatarImage
                                    src={member.user.image ?? undefined}
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
                                  <div className="truncate text-xs text-muted-foreground">
                                    {member.user.username}
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="truncate text-muted-foreground">
                              {member.user.email}
                            </TableCell>
                            <TableCell>
                              {canManageMember ? (
                                <Select
                                  value={member.role}
                                  onValueChange={(value) => {
                                    const nextRole = value as TeamRole
                                    if (nextRole === member.role) return
                                    setPendingRoleChange({
                                      member,
                                      role: nextRole,
                                    })
                                  }}
                                  disabled={
                                    busyId === member.user.id || isLastOwner
                                  }
                                >
                                  <SelectTrigger size="sm">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {canManageOwners ? (
                                      <SelectItem value="owner">
                                        Owner
                                      </SelectItem>
                                    ) : null}
                                    <SelectItem value="admin">Admin</SelectItem>
                                    <SelectItem value="member">
                                      Member
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                              ) : (
                                <span className="capitalize text-muted-foreground">
                                  {member.role}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="ml-auto flex items-center justify-end gap-1">
                                {canTransferToMember ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        type="button"
                                        aria-label={`Transfer ownership to ${displayName}`}
                                        disabled={busyId === member.user.id}
                                        onClick={() =>
                                          setPendingOwnershipTransfer(member)
                                        }
                                      >
                                        <UserRoundCheckIcon />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      Transfer ownership
                                    </TooltipContent>
                                  </Tooltip>
                                ) : null}
                                {canManageMember ? (
                                  <AlertDialog>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <AlertDialogTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            type="button"
                                            aria-label="Remove member"
                                            className="text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20"
                                            disabled={
                                              busyId === member.user.id ||
                                              isLastOwner
                                            }
                                            onClick={() =>
                                              setRemoveMemberConfirmation('')
                                            }
                                          >
                                            <Trash2Icon />
                                          </Button>
                                        </AlertDialogTrigger>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        Remove member
                                      </TooltipContent>
                                    </Tooltip>
                                    <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>
                                          Remove {displayName}?
                                        </AlertDialogTitle>
                                        <AlertDialogDescription>
                                          This removes the member from the team.
                                          They will no longer have access to
                                          this team or its projects.{' '}
                                          {`Type "${member.user.email}" to confirm.`}
                                        </AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <div className="space-y-3">
                                        <Input
                                          aria-label={`Type ${member.user.email} to confirm`}
                                          id={`remove-member-${member.user.id}`}
                                          placeholder={member.user.email}
                                          value={removeMemberConfirmation}
                                          onChange={(event) =>
                                            setRemoveMemberConfirmation(
                                              event.target.value,
                                            )
                                          }
                                          onKeyDown={(event) => {
                                            if (
                                              event.key === 'Enter' &&
                                              busyId !== member.user.id &&
                                              removeMemberConfirmation ===
                                                member.user.email
                                            ) {
                                              event.preventDefault()
                                              void removeMember(member.user.id)
                                            }
                                          }}
                                        />
                                      </div>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel
                                          disabled={busyId === member.user.id}
                                        >
                                          Cancel
                                        </AlertDialogCancel>
                                        <AlertDialogAction
                                          variant="destructive"
                                          disabled={
                                            busyId === member.user.id ||
                                            removeMemberConfirmation !==
                                              member.user.email
                                          }
                                          onClick={(event) => {
                                            event.preventDefault()
                                            void removeMember(member.user.id)
                                          }}
                                        >
                                          {busyId === member.user.id ? (
                                            <LoaderIcon className="animate-spin" />
                                          ) : null}
                                          Remove member
                                        </AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                ) : null}
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
                page={memberPage}
                pageCount={memberPageCount}
                onPageChange={setMemberPage}
              />
            </div>
            {invites.length > 0 ? (
              <div className="space-y-4">
                <h3 className="text-sm font-medium">
                  {invites.length}{' '}
                  {invites.length === 1 ? 'pending invite' : 'pending invites'}
                </h3>
                <div className="overflow-hidden rounded-xl border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead className="w-[120px]">Role</TableHead>
                        <TableHead className="w-[120px]">Expires</TableHead>
                        <TableHead className="w-28">
                          <span className="sr-only">Actions</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invites.map((invite) => (
                        <TableRow key={invite.id}>
                          <TableCell className="truncate font-medium text-foreground">
                            {invite.email}
                          </TableCell>
                          <TableCell className="capitalize text-muted-foreground">
                            {invite.role}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatInviteDate(invite.expiresAt)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="ml-auto flex items-center justify-end gap-1">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    type="button"
                                    aria-label="Resend invite"
                                    disabled={busyId === invite.id}
                                    onClick={() => void resendInvite(invite.id)}
                                  >
                                    <RefreshCwIcon />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Resend invite</TooltipContent>
                              </Tooltip>
                              <AlertDialog>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <AlertDialogTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        type="button"
                                        aria-label="Revoke invite"
                                        className="text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20"
                                        disabled={busyId === invite.id}
                                      >
                                        <Trash2Icon />
                                      </Button>
                                    </AlertDialogTrigger>
                                  </TooltipTrigger>
                                  <TooltipContent>Revoke invite</TooltipContent>
                                </Tooltip>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>
                                      Revoke invite?
                                    </AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This revokes the pending invitation for{' '}
                                      {invite.email}.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel
                                      disabled={busyId === invite.id}
                                    >
                                      Cancel
                                    </AlertDialogCancel>
                                    <AlertDialogAction
                                      variant="destructive"
                                      disabled={busyId === invite.id}
                                      onClick={(event) => {
                                        event.preventDefault()
                                        void revokeInvite(invite.id)
                                      }}
                                    >
                                      {busyId === invite.id ? (
                                        <LoaderIcon className="animate-spin" />
                                      ) : null}
                                      Revoke invite
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : null}
            <AlertDialog
              open={Boolean(pendingRoleChange)}
              onOpenChange={(open) => {
                if (!open) setPendingRoleChange(null)
              }}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Change member role?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {pendingRoleChange ? (
                      <>
                        This will change{' '}
                        {pendingRoleChange.member.user.name ||
                          pendingRoleChange.member.user.email}{' '}
                        to {pendingRoleChange.role}.
                      </>
                    ) : null}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel
                    disabled={
                      pendingRoleChange
                        ? busyId === pendingRoleChange.member.user.id
                        : false
                    }
                  >
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    disabled={
                      pendingRoleChange
                        ? busyId === pendingRoleChange.member.user.id
                        : true
                    }
                    onClick={(event) => {
                      event.preventDefault()
                      if (!pendingRoleChange) return
                      void updateRole(
                        pendingRoleChange.member.user.id,
                        pendingRoleChange.role,
                      ).then(() => setPendingRoleChange(null))
                    }}
                  >
                    {pendingRoleChange &&
                    busyId === pendingRoleChange.member.user.id ? (
                      <LoaderIcon className="animate-spin" />
                    ) : null}
                    Change role
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <AlertDialog
              open={Boolean(pendingOwnershipTransfer)}
              onOpenChange={(open) => {
                if (!open) setPendingOwnershipTransfer(null)
              }}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Transfer ownership?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {pendingOwnershipTransfer ? (
                      <>
                        This will make{' '}
                        {pendingOwnershipTransfer.user.name ||
                          pendingOwnershipTransfer.user.email}{' '}
                        the team owner and change your role to admin.
                      </>
                    ) : null}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel
                    disabled={
                      pendingOwnershipTransfer
                        ? busyId === pendingOwnershipTransfer.user.id
                        : false
                    }
                  >
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    disabled={
                      pendingOwnershipTransfer
                        ? busyId === pendingOwnershipTransfer.user.id
                        : true
                    }
                    onClick={(event) => {
                      event.preventDefault()
                      if (!pendingOwnershipTransfer) return
                      void transferOwnership(pendingOwnershipTransfer.user.id)
                    }}
                  >
                    {pendingOwnershipTransfer &&
                    busyId === pendingOwnershipTransfer.user.id ? (
                      <LoaderIcon className="animate-spin" />
                    ) : null}
                    Transfer ownership
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </SettingsSection>

        <SettingsSection
          id="danger"
          title="Danger zone"
          description="Permanently delete the team and all of its settings, projects and deployments."
        >
          {!canDeleteTeamByRole(team.role) ? (
            <Alert>
              <InfoIcon />
              <AlertTitle>Only team owners can delete a team.</AlertTitle>
            </Alert>
          ) : !canDeleteTeam ? (
            <Alert>
              <InfoIcon />
              <AlertTitle>
                {isDefaultTeam
                  ? 'This is your default team, you cannot leave or delete it.'
                  : 'This team is a default team, it cannot be deleted.'}
              </AlertTitle>
            </Alert>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  disabled={isDeletingTeam}
                  onClick={() => setDeleteTeamConfirmation('')}
                >
                  {isDeletingTeam ? (
                    <LoaderIcon className="animate-spin" />
                  ) : (
                    <Trash2Icon />
                  )}
                  Delete team
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this team?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes the team, its projects, servers,
                    members, and pending invites. This cannot be undone.{' '}
                    {`Type "${team.slug}" to confirm.`}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-3">
                  <Input
                    aria-label={`Type ${team.slug} to confirm`}
                    id="delete-team-confirmation"
                    placeholder={team.slug}
                    value={deleteTeamConfirmation}
                    onChange={(event) =>
                      setDeleteTeamConfirmation(event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (
                        event.key === 'Enter' &&
                        !isDeletingTeam &&
                        deleteTeamConfirmation === team.slug
                      ) {
                        event.preventDefault()
                        void deleteCurrentTeam()
                      }
                    }}
                  />
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isDeletingTeam}>
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    disabled={
                      isDeletingTeam || deleteTeamConfirmation !== team.slug
                    }
                    onClick={(event) => {
                      event.preventDefault()
                      void deleteCurrentTeam()
                    }}
                  >
                    {isDeletingTeam ? (
                      <LoaderIcon className="animate-spin" />
                    ) : null}
                    Delete team
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </SettingsSection>
      </div>

      <aside className="hidden pt-16 text-sm lg:block">
        <nav className="sticky top-[122px] flex flex-col gap-y-1">
          <Button asChild variant="ghost" size="sm" className="justify-start">
            <a href="#general">General</a>
          </Button>
          <Button asChild variant="ghost" size="sm" className="justify-start">
            <a href="#members">Members</a>
          </Button>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <a href="#danger">Danger</a>
          </Button>
        </nav>
      </aside>
    </div>
  )
}

function SettingsSection({
  children,
  description,
  footer,
  id,
  title,
}: {
  children: ReactNode
  description: string
  footer?: ReactNode
  id: string
  title: string
}) {
  return (
    <Card id={id} className="scroll-mt-8">
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
      {footer ? (
        <CardFooter className="justify-end gap-x-2">{footer}</CardFooter>
      ) : null}
    </Card>
  )
}

function SettingsActions({
  disabled,
  isSaving,
  onCancel,
  onSave,
}: {
  disabled: boolean
  isSaving: boolean
  onCancel: () => void
  onSave: () => void
}) {
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        type="button"
        onClick={onCancel}
        disabled={disabled || isSaving}
      >
        Cancel
      </Button>
      <Button size="sm" type="button" onClick={onSave} disabled={disabled}>
        {isSaving ? <LoaderIcon className="animate-spin" /> : null}
        Save
      </Button>
    </>
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

function formatInviteDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}
