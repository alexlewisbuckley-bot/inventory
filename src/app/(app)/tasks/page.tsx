import type { Metadata } from 'next'
import { requireCapability } from '@/server/auth/session'
import { findTasks } from '@/server/repositories/crm-repository'
import { assignableUsers } from '@/server/services/crm-service'
import { PageHeader } from '@/components/layout/PageHeader'
import { TaskList } from '@/components/crm/TaskList'
import { can } from '@/lib/permissions'

export const metadata: Metadata = { title: 'Tasks' }
export const dynamic = 'force-dynamic'

/**
 * Follow-ups.
 *
 * Defaults to your own, because a shared list of everybody's tasks is a list
 * nobody feels responsible for. `?everyone=1` widens it when a manager wants
 * the whole picture.
 */
export default async function TasksPage({ searchParams }: {
  searchParams: { everyone?: string }
}) {
  const user = await requireCapability('task:read')
  const mine = searchParams.everyone !== '1'

  const [tasks, assignees] = await Promise.all([
    findTasks({ status: ['OPEN', 'DONE'], assigneeId: mine ? [user.id] : undefined }),
    assignableUsers(),
  ])

  return (
    <>
      <PageHeader
        title="Tasks"
        description={mine
          ? 'What you have promised to do, soonest first.'
          : 'Every follow-up across the team.'}
        actions={
          <a
            href={mine ? '/tasks?everyone=1' : '/tasks'}
            className="inline-flex h-11 items-center rounded-pill border-[1.5px] border-navy-700 px-5 text-body font-bold text-navy-700 transition-colors hover:bg-navy-700/5"
          >
            {mine ? 'Show everyone' : 'Only mine'}
          </a>
        }
      />
      <TaskList
        tasks={tasks}
        canComplete={can(user.role, 'task:update')}
        canCreate={can(user.role, 'task:create')}
        assignees={assignees}
      />
    </>
  )
}
