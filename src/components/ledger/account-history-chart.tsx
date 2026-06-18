import type {AccountDetailChartType, LedgerAccountDetailChartPoint} from './ledger-account-detail-model'

type AccountHistoryChartProps = {
  title: string
  description: string
  type: AccountDetailChartType
  points: LedgerAccountDetailChartPoint[]
  emptyMessage: string
}

const CHART_WIDTH = 640
const CHART_HEIGHT = 240
const CHART_PADDING = 28

export function AccountHistoryChart({title, description, type, points, emptyMessage}: AccountHistoryChartProps) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {points.length === 0 ? (
        <div className="flex min-h-48 items-center justify-center rounded-md border bg-muted/40 p-6 text-center text-sm text-muted-foreground">{emptyMessage}</div>
      ) : type === 'line' ? (
        <LineChart title={title} points={points} />
      ) : (
        <BarChart title={title} points={points} />
      )}
    </div>
  )
}

function BarChart({title, points}: {title: string; points: LedgerAccountDetailChartPoint[]}) {
  const values = points.map(point => point.value)
  const max = Math.max(0, ...values)
  const min = Math.min(0, ...values)
  const range = max - min || 1
  const chartWidth = CHART_WIDTH - CHART_PADDING * 2
  const chartHeight = CHART_HEIGHT - CHART_PADDING * 2
  const slotWidth = chartWidth / points.length
  const barWidth = Math.max(12, slotWidth * 0.58)
  const zeroY = CHART_PADDING + ((max - 0) / range) * chartHeight

  return (
    <div className="overflow-x-auto rounded-md border bg-background p-3">
      <svg role="img" aria-label={title} viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="min-w-[34rem]">
        <line x1={CHART_PADDING} x2={CHART_WIDTH - CHART_PADDING} y1={zeroY} y2={zeroY} className="stroke-muted-foreground/40" />
        {points.map((point, index) => {
          const x = CHART_PADDING + index * slotWidth + (slotWidth - barWidth) / 2
          const pointY = CHART_PADDING + ((max - point.value) / range) * chartHeight
          const y = Math.min(pointY, zeroY)
          const height = Math.max(2, Math.abs(zeroY - pointY))
          return (
            <g key={point.key}>
              <rect x={x} y={y} width={barWidth} height={height} rx="4" className={point.value >= 0 ? 'fill-primary' : 'fill-destructive'} />
              <text x={x + barWidth / 2} y={CHART_HEIGHT - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                {point.label}
              </text>
              <text x={x + barWidth / 2} y={Math.max(12, y - 6)} textAnchor="middle" className="fill-foreground text-[10px]">
                {formatNumber(point.value)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function LineChart({title, points}: {title: string; points: LedgerAccountDetailChartPoint[]}) {
  const values = points.map(point => point.value)
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1
  const chartWidth = CHART_WIDTH - CHART_PADDING * 2
  const chartHeight = CHART_HEIGHT - CHART_PADDING * 2
  const pointGap = points.length === 1 ? 0 : chartWidth / (points.length - 1)
  const coordinates = points.map((point, index) => {
    const x = points.length === 1 ? CHART_WIDTH / 2 : CHART_PADDING + index * pointGap
    const y = CHART_PADDING + ((max - point.value) / range) * chartHeight
    return {point, x, y}
  })
  const polylinePoints = coordinates.map(({x, y}) => `${x},${y}`).join(' ')

  return (
    <div className="overflow-x-auto rounded-md border bg-background p-3">
      <svg role="img" aria-label={title} viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="min-w-[34rem]">
        <polyline points={polylinePoints} fill="none" stroke="currentColor" strokeWidth="3" className="text-primary" />
        {coordinates.map(({point, x, y}) => (
          <g key={point.key}>
            <circle cx={x} cy={y} r="4" className="fill-primary" />
            <text x={x} y={CHART_HEIGHT - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">
              {point.label}
            </text>
            <text x={x} y={Math.max(12, y - 8)} textAnchor="middle" className="fill-foreground text-[10px]">
              {formatNumber(point.value)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

function formatNumber(value: number) {
  return value.toFixed(2)
}
