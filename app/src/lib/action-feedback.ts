import { toast } from 'sonner'

export async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${label} copied.`)
    return true
  } catch {
    toast.error(
      `Unable to copy ${label.toLowerCase()}. Please select and copy it manually.`,
    )
    return false
  }
}

// A committed mutation must not be reported as failed when its follow-up fails:
// retrying a create/queue operation could otherwise produce duplicates.
export async function afterMutation(
  task: () => Promise<unknown>,
  message: string,
) {
  try {
    await task()
    return true
  } catch {
    toast.warning(message)
    return false
  }
}

export async function refreshView(task: () => Promise<unknown>, id: string) {
  try {
    await task()
    toast.dismiss(id)
  } catch {
    toast.error(
      'Unable to refresh. Displayed information may be out of date. Please reload.',
      { id },
    )
  }
}

export async function navigateFilters(task: () => Promise<unknown>) {
  try {
    await task()
    toast.dismiss('filter-navigation')
  } catch {
    toast.error('Unable to apply filters. Please try again.', {
      id: 'filter-navigation',
    })
  }
}
