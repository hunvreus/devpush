import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from '@/components/ui/pagination'

export const tablePageSize = 10

export function TablePager({
  page,
  pageCount,
  onPageChange,
}: {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
}) {
  if (pageCount <= 1) {
    return null
  }

  const canGoBack = page > 1
  const canGoForward = page < pageCount

  return (
    <Pagination className="justify-end">
      <PaginationContent>
        <PaginationItem>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Go to first page"
            disabled={!canGoBack}
            onClick={() => onPageChange(1)}
          >
            <ChevronsLeftIcon />
          </Button>
        </PaginationItem>
        <PaginationItem>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Go to previous page"
            disabled={!canGoBack}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeftIcon />
          </Button>
        </PaginationItem>
        <PaginationItem>
          <span className="px-3 text-sm text-muted-foreground">
            Page {page} of {pageCount}
          </span>
        </PaginationItem>
        <PaginationItem>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Go to next page"
            disabled={!canGoForward}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRightIcon />
          </Button>
        </PaginationItem>
        <PaginationItem>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Go to last page"
            disabled={!canGoForward}
            onClick={() => onPageChange(pageCount)}
          >
            <ChevronsRightIcon />
          </Button>
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  )
}

export function getPageCount(itemCount: number, pageSize = tablePageSize) {
  return Math.max(1, Math.ceil(itemCount / pageSize))
}

export function getPageItems<T>(items: Array<T>, page: number) {
  const start = (page - 1) * tablePageSize
  return items.slice(start, start + tablePageSize)
}
