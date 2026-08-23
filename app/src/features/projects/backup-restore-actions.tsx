import { LoaderIcon, MoreHorizontalIcon } from 'lucide-react'
import { useState } from 'react'

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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type {
  ProjectBackupArtifact,
  ProjectBackupRun,
} from '@/server/projects/service'
import {
  formatArtifactLabel,
  getDefaultRestoreCommand,
  inferArtifactName,
} from './project-backup-utils'

export function BackupRunRestoreActions({
  artifacts,
  composeServices,
  composeVolumes,
  disabled,
  restoringArtifactId,
  run,
  onRestore,
}: {
  artifacts: Array<ProjectBackupArtifact>
  composeServices: Array<string>
  composeVolumes: Array<string>
  disabled: boolean
  restoringArtifactId: string | null
  run: ProjectBackupRun
  onRestore: (input: {
    artifact: ProjectBackupArtifact
    restoreCommand?: string
    run: ProjectBackupRun
    targetService?: string
    targetVolume?: string
  }) => void
}) {
  const restorableArtifacts = artifacts.filter(
    (artifact) => artifact.type === 'volume' || artifact.type === 'database',
  )
  const [selectedArtifact, setSelectedArtifact] =
    useState<ProjectBackupArtifact | null>(null)

  if (run.status !== 'succeeded' || restorableArtifacts.length === 0) {
    return <span />
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label="Backup run actions"
          >
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {restorableArtifacts.map((artifact) => (
            <DropdownMenuItem
              key={artifact.id}
              onSelect={(event) => {
                event.preventDefault()
                setSelectedArtifact(artifact)
              }}
            >
              Restore {formatArtifactLabel(artifact)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {selectedArtifact ? (
        <RestoreArtifactDialog
          artifact={selectedArtifact}
          composeServices={composeServices}
          composeVolumes={composeVolumes}
          isRestoring={restoringArtifactId === selectedArtifact.id}
          open
          run={run}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedArtifact(null)
            }
          }}
          onRestore={(input) => {
            onRestore(input)
            setSelectedArtifact(null)
          }}
        />
      ) : null}
    </>
  )
}

function RestoreArtifactDialog({
  artifact,
  composeServices,
  composeVolumes,
  isRestoring,
  open,
  run,
  onOpenChange,
  onRestore,
}: {
  artifact: ProjectBackupArtifact
  composeServices: Array<string>
  composeVolumes: Array<string>
  isRestoring: boolean
  open: boolean
  run: ProjectBackupRun
  onOpenChange: (open: boolean) => void
  onRestore: (input: {
    artifact: ProjectBackupArtifact
    restoreCommand?: string
    run: ProjectBackupRun
    targetService?: string
    targetVolume?: string
  }) => void
}) {
  const artifactName = inferArtifactName(artifact)
  const [targetVolume, setTargetVolume] = useState(
    artifact.type === 'volume'
      ? (composeVolumes.find((volume) => volume === artifactName) ??
          composeVolumes.at(0) ??
          artifactName)
      : '',
  )
  const [targetService, setTargetService] = useState(
    artifact.type === 'database'
      ? (composeServices.find((service) => service === artifactName) ??
          composeServices.at(0) ??
          artifactName)
      : '',
  )
  const [restoreCommand, setRestoreCommand] = useState(
    artifact.type === 'database'
      ? getDefaultRestoreCommand(targetService || artifactName)
      : '',
  )
  const canRestore =
    artifact.type === 'volume'
      ? targetVolume.trim() !== ''
      : targetService.trim() !== '' && restoreCommand.trim() !== ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restore {formatArtifactLabel(artifact)}</DialogTitle>
          <DialogDescription>
            This queues a restore job against {run.environmentName}. Volume
            restores stop the runtime while files are replaced.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>Source artifact</FieldLabel>
            <Input
              readOnly
              value={`${artifact.storage} · ${artifact.objectKey}`}
            />
          </Field>
          {artifact.type === 'volume' ? (
            <Field>
              <FieldLabel>Target volume</FieldLabel>
              <Select value={targetVolume} onValueChange={setTargetVolume}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select volume" />
                </SelectTrigger>
                <SelectContent>
                  {Array.from(new Set([artifactName, ...composeVolumes]))
                    .filter(Boolean)
                    .map((volume) => (
                      <SelectItem key={volume} value={volume}>
                        {volume}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <>
              <Field>
                <FieldLabel>Target service</FieldLabel>
                <Select
                  value={targetService}
                  onValueChange={(value) => {
                    setTargetService(value)
                    setRestoreCommand(getDefaultRestoreCommand(value))
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select service" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from(new Set([artifactName, ...composeServices]))
                      .filter(Boolean)
                      .map((service) => (
                        <SelectItem key={service} value={service}>
                          {service}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Restore command</FieldLabel>
                <Input
                  className="font-mono text-[13px]"
                  value={restoreCommand}
                  onChange={(event) => setRestoreCommand(event.target.value)}
                />
                <FieldDescription>
                  The decompressed dump is streamed to stdin.
                </FieldDescription>
              </Field>
            </>
          )}
        </FieldGroup>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={isRestoring}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canRestore || isRestoring}
            onClick={() =>
              onRestore({
                artifact,
                run,
                targetVolume,
                targetService,
                restoreCommand,
              })
            }
          >
            {isRestoring ? (
              <LoaderIcon data-icon="inline-start" className="animate-spin" />
            ) : null}
            Queue restore
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
