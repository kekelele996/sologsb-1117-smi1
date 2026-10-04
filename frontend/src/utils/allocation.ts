import type { BeeColony, DropPoint, Orchard, RentalPlacement } from '@/types'
import { suggestColonyBoxes } from '@/types'
import { toDateValue } from './geo'

/** 一份自有群在某地块的时间占用 */
export interface OwnOccupancy {
  colonyCode: string
  orchardId: string
  start: string
  end: string
}

/** 地块缺口行：需求、自有在租、租入在租、缺口、投放点容量 */
export interface GapRow {
  orchardId: string
  /** 建议箱数 = ⌈面积 × 需蜂强度⌉ */
  demand: number
  /** 自有群已安排箱数（投放点群号 + 蜂群当前所在地块去重） */
  ownBoxes: number
  /** 盛花期内最大在租箱数（租入排单，按日期区间并发口径） */
  rentedBoxes: number
  /** 缺口 = max(0, 需求 − 自有 − 租入） */
  gap: number
  /** 投放点容量合计 */
  capacity: number
  /** 盛花期内最大在园箱数是否超出投放点容量 */
  capacityExceeded: boolean
}

/** 汇总自有群在各地块的投放占用（口径与季内总表一致：投放点群号 + 蜂群当前所在地块，去重） */
export function buildOwnOccupancies(colonies: BeeColony[], dropPoints: DropPoint[], orchards: Orchard[]): OwnOccupancy[] {
  const list: OwnOccupancy[] = []
  const push = (item: OwnOccupancy): void => {
    if (!list.some((row) => row.colonyCode === item.colonyCode && row.orchardId === item.orchardId)) {
      list.push(item)
    }
  }
  dropPoints.forEach((point) => {
    point.colonyCodes.forEach((code) => {
      push({ colonyCode: code, orchardId: point.orchardId, start: point.dropWindow, end: point.withdrawTime })
    })
  })
  colonies.forEach((colony) => {
    if (colony.source === '租入') return
    if (!colony.currentOrchardId) return
    const orchard = orchards.find((item) => item.id === colony.currentOrchardId)
    if (!orchard) return
    push({
      colonyCode: colony.code,
      orchardId: colony.currentOrchardId,
      start: orchard.bloomStart,
      end: orchard.bloomEnd
    })
  })
  return list
}

/** 一组日期区间在 [winStart, winEnd] 内的最大并发箱数（扫端点法，按天） */
export function maxConcurrentBoxes(
  intervals: { start: string; end: string; boxes: number }[],
  winStart: string,
  winEnd: string
): number {
  const points = new Map<number, number>()
  intervals.forEach((item) => {
    const s = Math.max(toDateValue(item.start), toDateValue(winStart))
    const e = Math.min(toDateValue(item.end), toDateValue(winEnd))
    if (Number.isNaN(s) || Number.isNaN(e) || s > e) return
    points.set(s, (points.get(s) ?? 0) + item.boxes)
    // 结束日次日减去占用（区间含首尾）
    points.set(e + 86400000, (points.get(e + 86400000) ?? 0) - item.boxes)
  })
  let current = 0
  let max = 0
  Array.from(points.keys())
    .sort((a, b) => a - b)
    .forEach((day) => {
      current += points.get(day) ?? 0
      max = Math.max(max, current)
    })
  return max
}

/**
 * 重算各地块缺口与容量占用。
 * 花期或投放点容量改动后，页面随 store 数据变化自动重算（纯函数，无缓存）。
 */
export function computeGapTable(
  orchards: Orchard[],
  colonies: BeeColony[],
  dropPoints: DropPoint[],
  placements: RentalPlacement[]
): GapRow[] {
  const ownOccupancies = buildOwnOccupancies(colonies, dropPoints, orchards)

  return orchards.map((orchard) => {
    const demand = suggestColonyBoxes(orchard)
    const ownCodes = new Set(
      ownOccupancies.filter((item) => item.orchardId === orchard.id).map((item) => item.colonyCode)
    )
    const ownBoxes = ownCodes.size

    const rentedIntervals = placements
      .filter((item) => item.orchardId === orchard.id)
      .map((item) => ({ start: item.startDate, end: item.endDate, boxes: item.boxCount }))
    const rentedBoxes = maxConcurrentBoxes(rentedIntervals, orchard.bloomStart, orchard.bloomEnd)

    const capacity = dropPoints
      .filter((point) => point.orchardId === orchard.id)
      .reduce((sum, point) => sum + (point.capacityBoxes || 0), 0)

    const ownIntervals = ownOccupancies
      .filter((item) => item.orchardId === orchard.id)
      .map((item) => ({ start: item.start, end: item.end, boxes: 1 }))
    const peakBoxes = maxConcurrentBoxes([...ownIntervals, ...rentedIntervals], orchard.bloomStart, orchard.bloomEnd)

    return {
      orchardId: orchard.id,
      demand,
      ownBoxes,
      rentedBoxes,
      gap: Math.max(0, demand - ownBoxes - rentedBoxes),
      capacity,
      capacityExceeded: capacity > 0 && peakBoxes > capacity
    }
  })
}

/** 合同在某一天的在租箱数（排单区间覆盖当天的箱数合计） */
export function rentedOutBoxes(placements: RentalPlacement[], contractId: string, today: string): number {
  const day = toDateValue(today)
  if (Number.isNaN(day)) return 0
  return placements
    .filter((item) => item.contractId === contractId)
    .filter((item) => toDateValue(item.startDate) <= day && day <= toDateValue(item.endDate))
    .reduce((sum, item) => sum + item.boxCount, 0)
}
