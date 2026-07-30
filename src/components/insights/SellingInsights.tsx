import { Bar } from '@/components/charts/Bar'
import { ChartFrame } from '@/components/charts/ChartFrame'
import { humanDuration } from '@/lib/deal-stages'
import { DEAL_STAGE_LABELS, type DealStage } from '@/lib/enums'
import type { SellingInsights as Data } from '@/server/repositories/insights-repository'

/**
 * The selling section of Insights.
 *
 * Three questions, one panel each: where do deals fall out (the funnel), how
 * often do they land (win rate), and where do they get stuck (dwell). All of
 * it is read from `deal_stage_events`, which the product has been writing
 * since the CRM shipped and aggregating for the first time here.
 *
 * Every figure links to the list that produces it, because a number you
 * cannot open is a number you cannot check — and drill-through that returns a
 * different count than its headline is worse than none, which is why the
 * links carry the same filter the query used.
 */
export function SellingInsightsPanel({ data, lost, money }: {
  data: Data
  lost: Array<{ reason: string; count: number; valueGbp: number }>
  money: (value: number | null) => string
}) {
  const { funnel, winRate, dwell } = data

  if (data.dealCount === 0) {
    // No pretend charts over an empty pipeline. The section says what it
    // will show and how to feed it, and takes no more room than that.
    return (
      <section className="rounded-lg border border-line-subtle bg-surface-raised px-6 py-5">
        <h3 className="text-small font-bold text-content-primary">Selling</h3>
        <p className="mt-1 text-small text-content-secondary">
          Once deals move through the pipeline, this section shows where they fall out,
          how often they land, and which stages they get stuck in.
        </p>
      </section>
    )
  }

  const top = funnel[0]!.reached

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <ChartFrame
        title="Where deals fall out"
        description={`Of ${top} ${top === 1 ? 'deal' : 'deals'} opened, how many reached each stage.`}
        table={{
          columns: ['Stage', 'Reached', 'Of previous', 'Of all'],
          rows: funnel.map((step) => ({
            label: DEAL_STAGE_LABELS[step.stage],
            values: [
              step.reached,
              `${Math.round(step.conversionFromPrevious * 100)}%`,
              `${Math.round(step.conversionFromTop * 100)}%`,
            ],
          })),
        }}
      >
        <Bar
          max={top}
          data={funnel.map((step) => ({
            label: DEAL_STAGE_LABELS[step.stage],
            value: step.reached,
            caption: step.stage === funnel[0]!.stage
              ? undefined
              : `${Math.round(step.conversionFromPrevious * 100)}% of the previous stage`,
            // The board, not a stage-filtered list. "Reached Sourcing" is a
            // cumulative count including deals now further along; a list of
            // deals *currently in* Sourcing would show a different number, and
            // a drill-through that disagrees with its headline is worse than
            // none.
            href: '/pipeline',
          }))}
        />
      </ChartFrame>

      <div className="flex flex-col gap-4">
        <ChartFrame
          title="How often deals land"
          description="Closed deals only — an open pipeline is not evidence either way."
          table={{
            columns: ['Outcome', 'Deals', 'Value'],
            rows: [
              { label: 'Won', values: [winRate.won, money(winRate.wonValueGbp)] },
              { label: 'Lost', values: [winRate.lost, money(winRate.lostValueGbp)] },
            ],
          }}
        >
          {winRate.rate === null ? (
            <p className="text-small text-content-secondary">
              Nothing has closed yet. The rate appears once a deal is won or lost.
            </p>
          ) : (
            <div>
              <p className="text-h1 font-extrabold tabular-nums text-content-primary">
                {Math.round(winRate.rate * 100)}%
              </p>
              <p className="mt-1 text-small text-content-secondary">
                {winRate.won} won at {money(winRate.wonValueGbp)} ·{' '}
                {winRate.lost} lost at {money(winRate.lostValueGbp)}
              </p>
            </div>
          )}
        </ChartFrame>

        <ChartFrame
          title="Where deals get stuck"
          description="Mean time in each stage, measured moves only."
          table={{
            columns: ['Stage', 'Mean time', 'Visits'],
            rows: dwell.map((entry) => ({
              label: DEAL_STAGE_LABELS[entry.stage as DealStage],
              values: [humanDuration(entry.meanMs), entry.visits],
            })),
          }}
        >
          {dwell.length === 0 ? (
            <p className="text-small text-content-secondary">
              No completed stage moves yet — a deal has to leave a stage before the
              stage can have a duration.
            </p>
          ) : (
            <Bar
              data={dwell.slice(0, 5).map((entry) => ({
                label: DEAL_STAGE_LABELS[entry.stage as DealStage],
                value: entry.meanMs,
                display: humanDuration(entry.meanMs),
                caption: `${entry.visits} ${entry.visits === 1 ? 'measured visit' : 'measured visits'}`,
                slot: 4,
              }))}
            />
          )}
        </ChartFrame>

        {lost.length > 0 && (
          <ChartFrame
            title="Why deals are lost"
            description="The reasons the Lost dialog has been insisting on, put to work."
            table={{
              columns: ['Reason', 'Deals', 'Value'],
              rows: lost.map((row) => ({
                label: row.reason,
                values: [row.count, money(row.valueGbp)],
              })),
            }}
          >
            <Bar
              data={lost.map((row) => ({
                label: row.reason,
                value: row.count,
                caption: money(row.valueGbp),
                slot: 2,
              }))}
            />
          </ChartFrame>
        )}
      </div>
    </div>
  )
}
