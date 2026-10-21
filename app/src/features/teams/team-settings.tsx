import DeploymentWorkspaceSettings, {
  workspaceSettingsNavigation,
} from '#devpush/deployment/ui'
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty'
import { useSettingsVersion } from '@/lib/use-settings-version'
import { backupsEnabled } from '@/lib/backup-feature'
import { showSettingsConflict } from '@/lib/settings-conflict'
import { CopyButton } from '@/components/copy-button'
import { BackupStorageSettings } from './backup-storage-settings'
import type { BackupStorageSummary } from '@/lib/backup-storage-schema'
import { setTeamContextQueryData } from '@/lib/team-context-query'
import { bulkInviteSchema, parseInviteEmails } from '@/lib/team-forms-schema'
import { useAvatarInput } from '@/lib/use-avatar-input'
import { afterMutation, copyText } from '@/lib/action-feedback'
import { teamGeneralSchema } from '@/lib/team-settings-schema'
import { formErrors } from '@/lib/form-errors'
import type { FormErrors } from '@/lib/form-errors'
import { useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
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
import { toast } from 'sonner'

import {
  getPageCount,
  getPageItems,
  TablePager,
} from '@/components/table-pager'
import { teamSettingsNavigationItems } from './navigation'
import { TeamHeading } from './team-heading'
import { SettingsLayout, SettingsSection } from '@/components/settings-layout'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { getPublicErrorMessage } from '@/lib/public-error'
import { invalidateResourceQueries } from '@/lib/resource-cache'
import {
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
} from '@/server/teams/types'

export function TeamSettings({
  backupStorage = [],
  canDeleteTeam,
  currentUserId,
  isDefaultTeam,
  invites,
  members,
  team,
}: {
  backupStorage?: BackupStorageSummary[]
  canDeleteTeam: boolean
  currentUserId: string
  isDefaultTeam: boolean
  invites: Array<TeamInviteSummary>
  members: Array<TeamMemberSummary>
  team: TeamSummary
}) {
  const router = useRouter()
  const queryClient = useQueryClient()

  async function refreshTeam() {
    await afterMutation(
      () => invalidateResourceQueries(queryClient, team.slug),
      'The action completed, but refreshing the data failed. Please reload.',
    )
    await afterMutation(
      () => router.invalidate(),
      'The action completed, but refreshing the page failed. Please reload.',
    )
  }
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [savedGeneral, setSavedGeneral] = useState(team)
  const [generalErrors, setGeneralErrors] = useState<FormErrors>({})
  const [name, setName] = useState(team.name)
  const [slug, setSlug] = useState(team.slug)
  const {
    dataUrl: avatarDataUrl,
    setDataUrl: setAvatarDataUrl,
    read: readAvatar,
    cancelRead: cancelAvatarRead,
    pending: isReadingAvatar,
  } = useAvatarInput()
  const [deleteAvatar, setDeleteAvatar] = useState(false)
  const [isSavingGeneral, setIsSavingGeneral] = useState(false)
  const [memberQuery, setMemberQuery] = useState('')
  const [bulkInviteErrors, setBulkInviteErrors] = useState<FormErrors>({})
  const [bulkInviteEmails, setBulkInviteEmails] = useState('')
  const [bulkInviteRole, setBulkInviteRole] = useState<'admin' | 'member'>(
    'member',
  )
  const [bulkInviteDialogOpen, setBulkInviteDialogOpen] = useState(false)
  const [memberPage, setMemberPage] = useState(1)
  const [isBulkInviting, setIsBulkInviting] = useState(false)
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const [teamDeleted, setTeamDeleted] = useState(false)
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
  const avatarUrl = deleteAvatar ? null : (avatarDataUrl ?? team.image)
  const generalDirty =
    isReadingAvatar ||
    name.trim() !== savedGeneral.name ||
    slug.trim() !== savedGeneral.slug ||
    Boolean(avatarDataUrl) ||
    deleteAvatar

  const settingsVersion = useSettingsVersion({
    version: team.settingsVersion,
    dirty: generalDirty,
    saving: isSavingGeneral,
    refresh: () => {
      setName(team.name)
      setSlug(team.slug)
      setSavedGeneral(team)
      setGeneralErrors({})
    },
  })

  function resetGeneral() {
    settingsVersion.current = team.settingsVersion
    setSavedGeneral(team)
    setGeneralErrors({})
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
    cancelAvatarRead()
    setGeneralErrors((current) => ({ ...current, avatarDataUrl: undefined }))

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setGeneralErrors((current) => ({
        ...current,
        avatarDataUrl: 'Upload a PNG, JPEG, or WebP image.',
      }))
      return
    }

    if (file.size > 2 * 1024 * 1024) {
      setGeneralErrors((current) => ({
        ...current,
        avatarDataUrl: 'Avatars must be 2 MB or smaller.',
      }))
      return
    }

    try {
      const dataUrl = await readAvatar(file)
      if (dataUrl === null) return
      setAvatarDataUrl(dataUrl)
      setDeleteAvatar(false)
    } catch {
      setGeneralErrors((current) => ({
        ...current,
        avatarDataUrl:
          'Unable to read this image. Please choose it again or try another file.',
      }))
    }
  }

  async function saveGeneral() {
    if (!canManageMembers) return
    if (isSavingGeneral || isReadingAvatar || !generalDirty) return
    const parsed = teamGeneralSchema.safeParse({
      teamId: team.id,
      settingsVersion: settingsVersion.current,
      teamSlug: team.slug,
      name,
      slug,
      avatarDataUrl,
      deleteAvatar,
    })
    if (!parsed.success) {
      const errors = formErrors(parsed.error.issues)
      if (errors.form) toast.error(errors.form)
      setGeneralErrors(errors)
      document
        .getElementById(
          `team-${errors.name ? 'name' : errors.slug ? 'slug' : 'avatar-button'}`,
        )
        ?.focus()
      return
    }
    setGeneralErrors({})
    setIsSavingGeneral(true)

    try {
      const result = await updateTeamGeneralAction({ data: parsed.data })
      if (result.fieldErrors) {
        if (result.fieldErrors.form) toast.error(result.fieldErrors.form)
        setGeneralErrors(result.fieldErrors)
        return
      }
      const nextTeam = result.team
      settingsVersion.current = nextTeam.settingsVersion
      setSavedGeneral(nextTeam)
      setName(nextTeam.name)
      setSlug(nextTeam.slug)
      await setTeamContextQueryData(queryClient, nextTeam)
      setAvatarDataUrl(null)
      setDeleteAvatar(false)
      toast.success('Team settings saved.')
      if (nextTeam.slug !== team.slug) {
        await invalidateResourceQueries(queryClient)
        await afterMutation(
          () =>
            router.navigate({
              to: '/$teamSlug/settings',
              params: { teamSlug: nextTeam.slug },
            }),
          'The action completed, but opening the next page failed. Please reload.',
        )
      }
    } catch (error) {
      if (showSettingsConflict(error)) return
      toast.error(
        getPublicErrorMessage(error, 'Unable to save team. Please try again.'),
      )
    } finally {
      setIsSavingGeneral(false)
    }
  }

  async function sendBulkInvites() {
    if (isBulkInviting) return
    const parsed = bulkInviteSchema.safeParse({
      teamSlug: team.slug,
      emails: bulkInviteEmails,
      role: bulkInviteRole,
    })
    if (!parsed.success) {
      setBulkInviteErrors(formErrors(parsed.error.issues))
      document.getElementById('bulk-invite-emails')?.focus()
      return
    }
    const submitted = bulkInviteEmails.split(/[\s,]+/).filter(Boolean)
    const existing = new Set(
      members.map((member) => member.user.email.toLowerCase()),
    )
    const emails = parseInviteEmails(bulkInviteEmails).filter(
      (email) => !existing.has(email),
    )
    const skipped = submitted.length - emails.length
    if (!emails.length) {
      toast.warning(
        `No invitations sent. ${skipped} ${skipped === 1 ? 'address' : 'addresses'} skipped.`,
      )
      setBulkInviteEmails('')
      setBulkInviteErrors({})
      setBulkInviteDialogOpen(false)
      return
    }
    setBulkInviteErrors({})
    setIsBulkInviting(true)

    try {
      const result = await createTeamInvitesAction({
        data: {
          teamSlug: team.slug,
          emails: emails.join(', '),
          role: bulkInviteRole,
        },
      })
      const summary = `${result.emailSentCount} ${result.emailSentCount === 1 ? 'invitation' : 'invitations'} sent.${skipped ? ` ${skipped} ${skipped === 1 ? 'address' : 'addresses'} skipped.` : ''}${result.emailCount > result.emailSentCount ? ` ${result.emailCount - result.emailSentCount} invitation email(s) failed to send.` : ''}${result.failedEmails.length ? ` ${result.failedEmails.length} address(es) could not be invited.` : ''}`
      if (
        result.failedEmails.length ||
        result.emailSentCount !== result.emailCount ||
        skipped
      )
        toast.warning(summary)
      else toast.success(summary)
      if (result.failedEmails.length) {
        setBulkInviteEmails(
          result.failedEmails.map((item) => item.email).join('\n'),
        )
        setBulkInviteErrors({
          emails: result.failedEmails.map((item) => item.message).join(' '),
        })
      } else {
        setBulkInviteEmails('')
        setBulkInviteRole('member')
        setBulkInviteDialogOpen(false)
      }
      await refreshTeam()
    } catch (error) {
      if (showSettingsConflict(error)) return
      toast.error(
        getPublicErrorMessage(
          error,
          'Unable to send invites. Please try again.',
        ),
      )
    } finally {
      setIsBulkInviting(false)
    }
  }

  async function updateRole(memberUserId: string, role: TeamRole) {
    if (busyId || isDeletingTeam || teamDeleted) return

    setBusyId(memberUserId)

    try {
      await updateTeamMemberRoleAction({
        data: { teamSlug: team.slug, memberUserId, role },
      })
      toast.success('Member role updated.')
      await refreshTeam()
      setPendingRoleChange(null)
    } catch (error) {
      if (showSettingsConflict(error)) return
      toast.error(getPublicErrorMessage(error, 'Unable to update member.'))
    } finally {
      setBusyId(null)
    }
  }

  async function removeMember(memberUserId: string) {
    const member = members.find((item) => item.user.id === memberUserId)
    if (!member || removeMemberConfirmation !== member.user.email) return
    if (busyId || isDeletingTeam || teamDeleted) return

    setBusyId(memberUserId)

    try {
      await removeTeamMemberAction({
        data: { teamSlug: team.slug, memberUserId },
      })
      setConfirmation(null)
      toast.success('Member removed.')
      await refreshTeam()
    } catch (error) {
      if (showSettingsConflict(error)) return
      toast.error(getPublicErrorMessage(error, 'Unable to remove member.'))
    } finally {
      setBusyId(null)
    }
  }

  async function transferOwnership(memberUserId: string) {
    if (busyId || isDeletingTeam || teamDeleted) return

    setBusyId(memberUserId)

    try {
      await transferTeamOwnershipAction({
        data: { teamSlug: team.slug, memberUserId },
      })
      setPendingOwnershipTransfer(null)
      toast.success('Ownership transferred.')
      await refreshTeam()
    } catch (error) {
      if (showSettingsConflict(error)) return
      toast.error(getPublicErrorMessage(error, 'Unable to transfer ownership.'))
    } finally {
      setBusyId(null)
    }
  }

  async function resendInvite(inviteId: string) {
    if (busyId || isDeletingTeam || teamDeleted) return

    setBusyId(inviteId)

    try {
      const result = await resendTeamInviteAction({
        data: { teamSlug: team.slug, inviteId },
      })
      await handleInviteResult(result, 'Invite resent.')
      await refreshTeam()
    } catch (error) {
      if (showSettingsConflict(error)) return
      toast.error(getPublicErrorMessage(error, 'Unable to resend invite.'))
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

    const copied = await copyText(result.inviteUrl, 'Invite link')
    toast.warning(
      copied
        ? 'Invite created, but email failed. Invite link copied.'
        : 'Invite created, but email and copying failed. Resend the invitation to try again.',
    )
  }

  async function revokeInvite(inviteId: string) {
    if (busyId || isDeletingTeam || teamDeleted) return

    setBusyId(inviteId)

    try {
      await revokeTeamInviteAction({ data: { teamSlug: team.slug, inviteId } })
      setConfirmation(null)
      toast.success('Invite revoked.')
      await refreshTeam()
    } catch (error) {
      if (showSettingsConflict(error)) return
      toast.error(getPublicErrorMessage(error, 'Unable to revoke invite.'))
    } finally {
      setBusyId(null)
    }
  }

  async function deleteCurrentTeam() {
    if (
      isDeletingTeam ||
      teamDeleted ||
      busyId ||
      !canDeleteTeam ||
      deleteTeamConfirmation !== team.slug
    )
      return

    setIsDeletingTeam(true)

    try {
      await deleteTeamAction({
        data: {
          teamSlug: team.slug,
          confirmationName: deleteTeamConfirmation,
        },
      })
      await invalidateResourceQueries(queryClient)
      setTeamDeleted(true)
      setConfirmation(null)
      toast.success('Team deleted.')
      await afterMutation(
        () => router.navigate({ to: '/' }),
        'The action completed, but opening the next page failed. Please reload.',
      )
    } catch (error) {
      if (showSettingsConflict(error)) return
      toast.error(getPublicErrorMessage(error, 'Unable to delete team.'))
    } finally {
      setIsDeletingTeam(false)
    }
  }

  return (
    <div className="space-y-8">
      <TeamHeading team={team} crumb={<span>Team settings</span>} />

      <SettingsLayout
        navigation={[
          ...teamSettingsNavigationItems.slice(0, 2),
          ...workspaceSettingsNavigation,
          ...teamSettingsNavigationItems.slice(2),
        ]}
      >
        <SettingsSection
          id="general"
          title="General"
          description="General settings for the team."
          footer={
            canManageMembers ? (
              <SettingsActions
                disabled={!generalDirty || isSavingGeneral}
                isSaving={isSavingGeneral}
                isReading={isReadingAvatar}
                onCancel={resetGeneral}
              />
            ) : undefined
          }
        >
          <form
            id="team-general-form"
            className="space-y-8"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              void saveGeneral()
            }}
          >
            <Field data-invalid={Boolean(generalErrors.avatarDataUrl)}>
              <FieldLabel>Avatar</FieldLabel>
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
                  disabled={!canManageMembers || isSavingGeneral}
                  aria-label="Team avatar"
                  aria-describedby="team-avatar-error"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(event) => {
                    void chooseAvatar(event.target.files?.[0])
                    event.target.value = ''
                  }}
                />
                {canManageMembers ? (
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    id="team-avatar-button"
                    disabled={isSavingGeneral}
                    aria-invalid={Boolean(generalErrors.avatarDataUrl)}
                    aria-describedby="team-avatar-error"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <UploadIcon data-icon="inline-start" />
                    Upload image
                  </Button>
                ) : null}
                {canManageMembers && avatarUrl ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="destructive"
                        size="icon-sm"
                        type="button"
                        aria-label="Remove image"
                        disabled={isSavingGeneral}
                        onClick={() => {
                          setAvatarDataUrl(null)
                          setDeleteAvatar(true)
                          setGeneralErrors((current) => ({
                            ...current,
                            avatarDataUrl: undefined,
                          }))
                        }}
                      >
                        <Trash2Icon />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Remove image</TooltipContent>
                  </Tooltip>
                ) : null}
              </div>
              {isReadingAvatar ? (
                <p role="status" className="text-sm text-muted-foreground">
                  Reading image…
                </p>
              ) : null}
              <FieldError id="team-avatar-error">
                {generalErrors.avatarDataUrl}
              </FieldError>
            </Field>

            <Field data-invalid={Boolean(generalErrors.name)}>
              <FieldLabel htmlFor="team-name">
                Display name{' '}
                <span className="text-muted-foreground">(required)</span>
              </FieldLabel>
              <Input
                id="team-name"
                readOnly={!canManageMembers}
                required
                disabled={isSavingGeneral}
                maxLength={100}
                aria-invalid={Boolean(generalErrors.name)}
                aria-describedby="team-name-error"
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  setGeneralErrors((current) => ({
                    ...current,
                    name: undefined,
                  }))
                }}
              />
              <FieldError id="team-name-error">{generalErrors.name}</FieldError>
            </Field>

            <Field data-invalid={Boolean(generalErrors.slug)}>
              <FieldLabel htmlFor="team-slug">
                Slug <span className="text-muted-foreground">(required)</span>
              </FieldLabel>
              <Input
                id="team-slug"
                readOnly={!canManageMembers}
                required
                disabled={isSavingGeneral}
                maxLength={100}
                aria-invalid={Boolean(generalErrors.slug)}
                aria-describedby="team-slug-error"
                value={slug}
                onChange={(event) => {
                  setSlug(event.target.value)
                  setGeneralErrors((current) => ({
                    ...current,
                    slug: undefined,
                  }))
                }}
              />
              <FieldError id="team-slug-error">{generalErrors.slug}</FieldError>
            </Field>

            <Field>
              <FieldLabel htmlFor="team-id">Team ID</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="team-id"
                  className="font-mono text-[13px] text-muted-foreground"
                  value={team.id}
                  readOnly
                />
                <InputGroupAddon align="inline-end">
                  <CopyButton value={team.id} label="Copy team ID" inputGroup />
                </InputGroupAddon>
              </InputGroup>
              <FieldDescription>
                A unique identifier used in API, environment variables, etc.
              </FieldDescription>
            </Field>
          </form>
        </SettingsSection>

        <SettingsSection
          id="members"
          title="Members"
          description="Manage the members of the team."
        >
          <div className="space-y-6">
            <div className="space-y-4">
              <Dialog
                open={bulkInviteDialogOpen}
                onOpenChange={(open) => {
                  if (!isBulkInviting) setBulkInviteDialogOpen(open)
                }}
              >
                <DialogContent>
                  <form
                    id="bulk-invite-form"
                    noValidate
                    className="grid gap-4"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void sendBulkInvites()
                    }}
                  >
                    <fieldset disabled={isBulkInviting} className="grid gap-4">
                      <DialogHeader>
                        <DialogTitle>Add members</DialogTitle>
                        <DialogDescription>
                          Paste email addresses separated by commas, spaces, or
                          new lines. Duplicate, invalid and existing member
                          addresses are skipped.
                        </DialogDescription>
                      </DialogHeader>
                      <FieldGroup>
                        <Field>
                          <FieldLabel htmlFor="bulk-invite-role">
                            Role
                          </FieldLabel>
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
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="bulk-invite-emails">
                            Email addresses
                          </FieldLabel>
                          <Textarea
                            id="bulk-invite-emails"
                            required
                            maxLength={20000}
                            aria-invalid={Boolean(bulkInviteErrors.emails)}
                            aria-describedby="bulk-invite-emails-error"
                            value={bulkInviteEmails}
                            onChange={(event) => {
                              setBulkInviteEmails(event.target.value)
                              setBulkInviteErrors({})
                            }}
                            placeholder="name@example.com"
                            className="resize-none max-h-64 overflow-y-auto"
                          />
                          <FieldError id="bulk-invite-emails-error">
                            {bulkInviteErrors.emails}
                          </FieldError>
                        </Field>
                      </FieldGroup>
                      <FieldError role="alert">
                        {bulkInviteErrors.form}
                      </FieldError>
                      <DialogFooter>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setBulkInviteDialogOpen(false)}
                          disabled={isBulkInviting}
                        >
                          Cancel
                        </Button>
                        <Button type="submit" disabled={isBulkInviting}>
                          {isBulkInviting ? (
                            <LoaderIcon
                              data-icon="inline-start"
                              className="animate-spin"
                            />
                          ) : null}
                          Add members
                        </Button>
                      </DialogFooter>
                    </fieldset>
                  </form>
                </DialogContent>
              </Dialog>
              <div className="flex items-center justify-between gap-2">
                <InputGroup className="max-w-72">
                  <InputGroupAddon>
                    <SearchIcon />
                  </InputGroupAddon>
                  <InputGroupInput
                    placeholder="Search..."
                    value={memberQuery}
                    onChange={(event) => setMemberQuery(event.target.value)}
                  />
                </InputGroup>
                {canManageMembers ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setBulkInviteErrors({})
                      setBulkInviteDialogOpen(true)
                    }}
                  >
                    <PlusIcon data-icon="inline-start" />
                    Add members
                  </Button>
                ) : null}
              </div>

              {filteredMembers.length === 0 ? (
                <Empty className="min-h-40">
                  <EmptyHeader>
                    <EmptyTitle>No members found.</EmptyTitle>
                    <EmptyDescription>
                      Try a different name, username or email.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <div className="overflow-hidden rounded-xl border bg-card text-card-foreground">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-4">Name</TableHead>
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
                          member.user.name ||
                          member.user.email.split('@')[0] ||
                          member.user.email
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
                            <TableCell className="pl-4">
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
                                  <SelectTrigger
                                    size="sm"
                                    aria-label={`Role for ${displayName}`}
                                  >
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
                              <div className="ml-auto">
                                <div className="-mr-2 flex items-center justify-end gap-1">
                                  {canTransferToMember ? (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          type="button"
                                          aria-label={`Transfer ownership to ${displayName}`}
                                          disabled={busyId === member.user.id}
                                          onClick={() => {
                                            setPendingOwnershipTransfer(member)
                                          }}
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
                                    <AlertDialog
                                      open={
                                        confirmation ===
                                        `remove:${member.user.id}`
                                      }
                                      onOpenChange={(open) => {
                                        if (
                                          !busyId &&
                                          !isDeletingTeam &&
                                          !teamDeleted
                                        ) {
                                          setConfirmation(
                                            open
                                              ? `remove:${member.user.id}`
                                              : null,
                                          )
                                        }
                                      }}
                                    >
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <AlertDialogTrigger asChild>
                                            <Button
                                              variant="destructive"
                                              size="icon"
                                              type="button"
                                              aria-label="Remove member"
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
                                            This removes the member from the
                                            team. They will no longer have
                                            access to this team or its projects.{' '}
                                            {`Type "${member.user.email}" to confirm.`}
                                          </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <Field>
                                          <Input
                                            aria-label={`Type ${member.user.email} to confirm`}
                                            id={`remove-member-${member.user.id}`}
                                            required
                                            disabled={Boolean(busyId)}
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
                                                void removeMember(
                                                  member.user.id,
                                                )
                                              }
                                            }}
                                          />
                                        </Field>
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
                <div className="overflow-hidden rounded-xl border bg-card text-card-foreground">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-4">Email</TableHead>
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
                          <TableCell className="pl-4 truncate font-medium text-foreground">
                            {invite.email}
                          </TableCell>
                          <TableCell className="capitalize text-muted-foreground">
                            {invite.role}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatInviteDate(invite.expiresAt)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="ml-auto">
                              <div className="-mr-2 flex items-center justify-end gap-1">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      type="button"
                                      aria-label="Resend invite"
                                      disabled={busyId === invite.id}
                                      onClick={() =>
                                        void resendInvite(invite.id)
                                      }
                                    >
                                      <RefreshCwIcon />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Resend invite</TooltipContent>
                                </Tooltip>
                                <AlertDialog
                                  open={confirmation === `revoke:${invite.id}`}
                                  onOpenChange={(open) => {
                                    if (
                                      !busyId &&
                                      !isDeletingTeam &&
                                      !teamDeleted
                                    ) {
                                      setConfirmation(
                                        open ? `revoke:${invite.id}` : null,
                                      )
                                    }
                                  }}
                                >
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <AlertDialogTrigger asChild>
                                        <Button
                                          variant="destructive"
                                          size="icon"
                                          type="button"
                                          aria-label="Remove invite"
                                          disabled={busyId === invite.id}
                                        >
                                          <Trash2Icon />
                                        </Button>
                                      </AlertDialogTrigger>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      Remove invite
                                    </TooltipContent>
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
                if (!open && !busyId) {
                  setPendingRoleChange(null)
                }
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
                      )
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
                if (!open && !busyId) {
                  setPendingOwnershipTransfer(null)
                }
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

        <DeploymentWorkspaceSettings teamSlug={team.slug} role={team.role} />
        {backupsEnabled ? (
          <BackupStorageSettings team={team} storage={backupStorage} />
        ) : null}
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
            <AlertDialog
              open={confirmation === 'delete'}
              onOpenChange={(open) => {
                if (!busyId && !isDeletingTeam && !teamDeleted) {
                  setConfirmation(open ? 'delete' : null)
                }
              }}
            >
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  disabled={isDeletingTeam || teamDeleted}
                  onClick={() => setDeleteTeamConfirmation('')}
                >
                  {isDeletingTeam ? (
                    <LoaderIcon
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                  ) : (
                    <Trash2Icon data-icon="inline-start" />
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
                <Field>
                  <Input
                    aria-label={`Type ${team.slug} to confirm`}
                    id="delete-team-confirmation"
                    required
                    disabled={isDeletingTeam || teamDeleted}
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
                </Field>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isDeletingTeam || teamDeleted}>
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
      </SettingsLayout>
    </div>
  )
}

function SettingsActions({
  disabled,
  isSaving,
  isReading,
  onCancel,
}: {
  disabled: boolean
  isSaving: boolean
  isReading: boolean
  onCancel: () => void
}) {
  return (
    <>
      <Button
        variant="ghost"
        type="button"
        onClick={onCancel}
        disabled={disabled || isSaving}
      >
        Cancel
      </Button>
      <Button
        type="submit"
        form="team-general-form"
        disabled={disabled || isReading}
      >
        {isSaving ? (
          <LoaderIcon data-icon="inline-start" className="animate-spin" />
        ) : null}
        Save
      </Button>
    </>
  )
}

function formatInviteDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}
