import type {
  BeeColony,
  ContractAssignment,
  ContractFee,
  ContractLifecycle,
  DropPoint,
  Orchard,
  RentalContract
} from '@/types'
import { suggestColonyBoxes } from '@/types'
import { toDateValue } from '@/utils/geo'
import { uid } from '@/utils/id'

/** 一天的毫秒数 */
export const DAY_MS = 86400000

/** 日期序号 +n 天，输出 YYYY-MM-DD */
export function addDays(date: string, offset: number): string {
  return new Date(toDateValue(date) + offset * DAY_MS).toISOString().slice(0, 10)
}

/** 两个闭区间（含首尾）的重叠天数 */
export function overlapDays(startA: string, endA: string, startB: string, endB: string): number {
  const a1 = toDateValue(startA)
  const a2 = toDateValue(endA)
  const b1 = toDateValue(startB)
  const b2 = toDateValue(endB)
  if ([a1, a2, b1, b2].some((value) => Number.isNaN(value))) return 0
  const start = Math.max(a1, b1)
  const end = Math.min(a2, b2)
  if (start > end) return 0
  return Math.round((end - start) / DAY_MS) + 1
}

/** 某日是否落在闭区间内 */
export function isWithin(date: string, start: string, end: string): boolean {
  return overlapDays(date, date, start, end) > 0
}

/** 闭区间天数（含首尾） */
export function inclusiveDays(start: string, end: string): number {
  const s = toDateValue(start)
  const e = toDateValue(end)
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 0
  return Math.round((e - s) / DAY_MS) + 1
}

/** 元金额四舍五入到分 */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

/** 某地块投放点总容量（箱）；无投放点时视为容量不限（返回 NaN） */
export function capacityOf(orchardId: string, dropPoints: DropPoint[]): number {
  const points = dropPoints.filter((item) => item.orchardId === orchardId)
  if (points.length === 0) return Number.NaN
  return points.reduce((sum, item) => sum + (Number(item.capacityBoxes) || 0), 0)
}

export interface OwnPlacement {
  code: string
  orchardId: string
  start: string
  end: string
}

/**
 * 汇总自有群的固定占用（租借群不计入自有池）：
 * ①投放点安排群号（投放窗 ~ 撤场）；②蜂群当前所在地块（盛花期）。
 * 同一群在同一地块重复出现时只保留一条。
 */
export function fixedOwnPlacements(
  colonies: BeeColony[],
  dropPoints: DropPoint[],
  orchards: Orchard[]
): OwnPlacement[] {
  const ownCodes = new Set(colonies.filter((item) => item.source !== '租借').map((item) => item.code))
  const list: OwnPlacement[] = []
  const push = (placement: OwnPlacement): void => {
    if (!ownCodes.has(placement.code)) return
    if (list.some((item) => item.code === placement.code && item.orchardId === placement.orchardId)) return
    list.push(placement)
  }
  dropPoints.forEach((point) => {
    point.colonyCodes.forEach((code) => {
      push({ code, orchardId: point.orchardId, start: point.dropWindow, end: point.withdrawTime })
    })
  })
  colonies.forEach((colony) => {
    if (colony.source === '租借' || !colony.currentOrchardId) return
    const orchard = orchards.find((item) => item.id === colony.currentOrchardId)
    if (!orchard) return
    push({ code: colony.code, orchardId: colony.currentOrchardId, start: orchard.bloomStart, end: orchard.bloomEnd })
  })
  return list
}

/** 某日某合同已投放的箱数（同一份合同在多段排期中的当日合计） */
export function contractUsedOn(
  contractId: string,
  date: string,
  assignments: ContractAssignment[]
): number {
  return assignments
    .filter((item) => item.contractId === contractId && isWithin(date, item.startDate, item.endDate))
    .reduce((sum, item) => sum + item.boxes, 0)
}

/** 某地块某日已排租蜂箱数 */
export function rentedBoxesOn(
  orchardId: string,
  date: string,
  assignments: ContractAssignment[]
): number {
  return assignments
    .filter((item) => item.orchardId === orchardId && isWithin(date, item.startDate, item.endDate))
    .reduce((sum, item) => sum + item.boxes, 0)
}

/** 某地块某合同在某日已排箱数（手工排期用于冲突预判） */
export function contractOrchardBoxesOn(
  contractId: string,
  orchardId: string,
  date: string,
  assignments: ContractAssignment[]
): number {
  return assignments
    .filter(
      (item) =>
        item.contractId === contractId &&
        item.orchardId === orchardId &&
        isWithin(date, item.startDate, item.endDate)
    )
    .reduce((sum, item) => sum + item.boxes, 0)
}

export interface GapDay {
  date: string
  /** 花期需蜂（箱，面积 × 强度） */
  demand: number
  /** 投放点容量（箱）；无投放点为 NaN */
  capacity: number
  /** 受容量封顶后的有效需求 */
  need: number
  /** 自有群固定占用箱数 */
  fixedOwn: number
  /** 自有池机动补位箱数 */
  poolOwn: number
  /** 租蜂补位箱数 */
  rented: number
  /** 剩余缺口箱数 */
  gap: number
}

export interface OrchardGap {
  orchard: Orchard
  days: GapDay[]
  /** 花期需求 */
  demand: number
  /** 容量（NaN 表示不限） */
  capacity: number
  /** 有效需求峰值（受容量封顶） */
  need: number
  /** 固定自有群峰值 */
  fixedOwn: number
  /** 机动自有补位峰值 */
  poolOwn: number
  /** 租蜂补位峰值 */
  rented: number
  /** 剩余缺口峰值 */
  gap: number
  /** 缺口峰值出现日期 */
  peakDate: string
  /** 需求是否超过投放点容量 */
  capacityLimited: boolean
}

export interface GapPlan {
  orchards: OrchardGap[]
  /** 全部地块缺口峰值合计 */
  totalGapPeak: number
  /** 当日（今天）在租箱数 */
  rentedToday: number
  /** 全季任一日租蜂在租峰值 */
  rentedPeak: number
}

/**
 * 缺口重算：逐地块、逐花期日期
 * 需求（⌈面积×强度⌉，容量封顶）− 固定自有 − 机动自有池 − 已排租蜂 = 缺口。
 * 自有群不够才产生缺口；机动池为全局共享，按地块起花期顺序逐日先到先得。
 */
export function computeGapPlan(
  orchards: Orchard[],
  colonies: BeeColony[],
  dropPoints: DropPoint[],
  assignments: ContractAssignment[],
  today = new Date().toISOString().slice(0, 10)
): GapPlan {
  const placements = fixedOwnPlacements(colonies, dropPoints, orchards)
  const ordered = [...orchards].sort((a, b) => a.bloomStart.localeCompare(b.bloomStart))
  /** 机动池逐日已占用的群号集合 */
  const poolBusyByDate = new Map<string, Set<string>>()

  const result: OrchardGap[] = ordered.map((orchard) => {
    const demand = suggestColonyBoxes(orchard)
    const capacity = capacityOf(orchard.id, dropPoints)
    const capacityLimited = Number.isFinite(capacity) && demand > capacity
    const need = Number.isFinite(capacity) ? Math.min(demand, capacity) : demand
    const days: GapDay[] = []
    const ownHere = placements.filter((item) => item.orchardId === orchard.id)
    const freeOwnCodes = colonies
      .filter((item) => item.source !== '租借')
      .map((item) => item.code)

    const count = inclusiveDays(orchard.bloomStart, orchard.bloomEnd)
    for (let offset = 0; offset < count; offset += 1) {
      const date = addDays(orchard.bloomStart, offset)
      const fixedCodes = new Set(
        ownHere.filter((item) => isWithin(date, item.start, item.end)).map((item) => item.code)
      )

      const rented = rentedBoxesOn(orchard.id, date, assignments)
      let pool = new Set(poolBusyByDate.get(date))
      // 池里若已含当天被任何地块固定占用的群，移出（固定占用优先，不占机动名额）
      placements
        .filter((item) => isWithin(date, item.start, item.end))
        .forEach((item) => pool.delete(item.code))
      const available = freeOwnCodes.filter((code) => !fixedCodes.has(code) && !pool.has(code))
      const residual = Math.max(0, need - fixedCodes.size - rented)
      const poolTake = Math.min(residual, available.length)
      const taken = available.slice(0, poolTake)
      taken.forEach((code) => pool.add(code))
      poolBusyByDate.set(date, pool)

      const fixedOwn = fixedCodes.size
      const poolOwn = taken.length
      days.push({
        date,
        demand,
        capacity,
        need,
        fixedOwn,
        poolOwn,
        rented,
        gap: Math.max(0, need - fixedOwn - poolOwn - rented)
      })
    }

    const peak = days.reduce(
      (acc, day) => (day.gap > acc.gap ? { gap: day.gap, date: day.date } : acc),
      { gap: 0, date: orchard.bloomStart }
    )
    const peakOf = (pick: (day: GapDay) => number): number => days.reduce((m, day) => Math.max(m, pick(day)), 0)
    return {
      orchard,
      days,
      demand,
      capacity,
      need,
      fixedOwn: peakOf((day) => day.fixedOwn),
      poolOwn: peakOf((day) => day.poolOwn),
      rented: peakOf((day) => day.rented),
      gap: peak.gap,
      peakDate: peak.date,
      capacityLimited
    }
  })

  const totalGapPeak = result.reduce((sum, item) => sum + item.gap, 0)
  const rentedOnDate = (date: string): number =>
    assignments
      .filter((item) => isWithin(date, item.startDate, item.endDate))
      .reduce((sum, item) => sum + item.boxes, 0)
  const rentedToday = rentedOnDate(today)
  const allDates = new Set<string>()
  assignments.forEach((item) => {
    const count = inclusiveDays(item.startDate, item.endDate)
    for (let i = 0; i < count; i += 1) allDates.add(addDays(item.startDate, i))
  })
  const rentedPeak = Array.from(allDates).reduce((max, date) => Math.max(max, rentedOnDate(date)), 0)

  return { orchards: result, totalGapPeak, rentedToday, rentedPeak }
}

export interface RentalFillResult {
  /** 建议新增的投放排段（尚未入库） */
  additions: ContractAssignment[]
  /** 补不平的缺口：地块 + 日期 + 缺口箱数 */
  uncovered: { orchardId: string; date: string; gap: number }[]
}

/**
 * 按合同箱数补缺口：逐地块逐日，起租日早、编号小的合同优先；
 * 同一份合同同一天不能投放到两个地块（跨地块占用受 boxCount 上限约束），
 * 已存在的相同（合同/地块/日期）排期不重复生成。
 */
export function planRentalFill(
  plan: GapPlan,
  contracts: RentalContract[],
  assignments: ContractAssignment[]
): RentalFillResult {
  const additions: ContractAssignment[] = []
  const uncovered: RentalFillResult['uncovered'] = []
  const usable = [...contracts].sort((a, b) =>
    a.rentStart === b.rentStart ? a.code.localeCompare(b.code, 'zh-Hans-CN') : a.rentStart.localeCompare(b.rentStart)
  )
  /** 运行态：合同 → 日期 → 已占用箱数（含已入库与本次新增） */
  const usedByContract = new Map<string, Map<string, number>>()
  const usedOf = (contractId: string, date: string): number =>
    usedByContract.get(contractId)?.get(date) ?? 0

  for (const gap of plan.orchards) {
    for (const day of gap.days) {
      let remain = day.gap
      for (const contract of usable) {
        if (remain <= 0) break
        if (!isWithin(day.date, contract.rentStart, contract.rentEnd)) continue
        let map = usedByContract.get(contract.id)
        if (!map) {
          map = new Map<string, number>()
          usedByContract.set(contract.id, map)
        }
        // day.gap 已剔除已入库排期，这里只需在已占用之上叠加；跨地块受合同箱数约束
        const alreadyOn = usedOf(contract.id, day.date) + contractUsedOn(contract.id, day.date, assignments)
        const availableBoxes = contract.boxCount - alreadyOn
        if (availableBoxes <= 0) continue
        const take = Math.min(remain, availableBoxes)
        map.set(day.date, alreadyOn + take)
        remain -= take
        additions.push({
          id: uid('asg'),
          contractId: contract.id,
          orchardId: gap.orchard.id,
          boxes: take,
          startDate: day.date,
          endDate: day.date
        })
      }
      if (remain > 0) uncovered.push({ orchardId: gap.orchard.id, date: day.date, gap: remain })
    }
  }

  return { additions: mergeRuns(additions), uncovered }
}

/** 把同合同、同地块、同箱数且日期连续的单日排段合并为一段 */
export function mergeRuns(rows: ContractAssignment[]): ContractAssignment[] {
  const groups = new Map<string, ContractAssignment[]>()
  rows.forEach((row) => {
    const key = `${row.contractId}|${row.orchardId}|${row.boxes}`
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  })
  const merged: ContractAssignment[] = []
  groups.forEach((list) => {
    const sorted = [...list].sort((a, b) => a.startDate.localeCompare(b.startDate))
    let current = sorted[0]
    for (let i = 1; i < sorted.length; i += 1) {
      const next = sorted[i]
      if (next.startDate === addDays(current.endDate, 1)) {
        current = { ...current, endDate: next.endDate }
      } else {
        merged.push(current)
        current = next
      }
    }
    merged.push(current)
  })
  return merged.sort((a, b) =>
    a.startDate === b.startDate ? a.contractId.localeCompare(b.contractId) : a.startDate.localeCompare(b.startDate)
  )
}

export interface AssignmentConflict {
  type: 'out-of-bloom' | 'out-of-contract' | 'contract-busy' | 'exceed-gap'
  message: string
}

/** 手工投放校验：租期/花期边界 + 同合同同日不排两块地 */
export function checkAssignment(
  draft: Omit<ContractAssignment, 'id'>,
  contracts: RentalContract[],
  orchards: Orchard[],
  assignments: ContractAssignment[],
  selfId?: string
): AssignmentConflict[] {
  const conflicts: AssignmentConflict[] = []
  const contract = contracts.find((item) => item.id === draft.contractId)
  const orchard = orchards.find((item) => item.id === draft.orchardId)
  if (!contract || !orchard) {
    conflicts.push({ type: 'out-of-contract', message: '合同或地块不存在' })
    return conflicts
  }
  if (draft.boxes <= 0) conflicts.push({ type: 'exceed-gap', message: '投放箱数必须大于 0' })
  if (overlapDays(draft.startDate, draft.endDate, contract.rentStart, contract.rentEnd) < inclusiveDays(draft.startDate, draft.endDate)) {
    conflicts.push({ type: 'out-of-contract', message: `排期超出合同租期 ${contract.rentStart} ~ ${contract.rentEnd}` })
  }
  if (overlapDays(draft.startDate, draft.endDate, orchard.bloomStart, orchard.bloomEnd) < inclusiveDays(draft.startDate, draft.endDate)) {
    conflicts.push({ type: 'out-of-bloom', message: `排期超出地块盛花期 ${orchard.bloomStart} ~ ${orchard.bloomEnd}` })
  }
  // 同合同同日不得在其它地块占用超过合同箱数
  const count = inclusiveDays(draft.startDate, draft.endDate)
  for (let i = 0; i < count; i += 1) {
    const date = addDays(draft.startDate, i)
    const other = assignments
      .filter((item) => item.id !== selfId && item.contractId === draft.contractId)
      .filter((item) => isWithin(date, item.startDate, item.endDate))
      .reduce((sum, item) => sum + item.boxes, 0)
    if (other + draft.boxes > contract.boxCount) {
      conflicts.push({
        type: 'contract-busy',
        message: `合同 ${contract.code} 在 ${date} 已在其它地块排 ${other} 箱，再排 ${draft.boxes} 箱将超过合同 ${contract.boxCount} 箱`
      })
      break
    }
  }
  return conflicts
}

/**
 * 费用预估（派生只读）：
 * - 超期天数 = max(0, 实际归还日(未登记取今天) − 归租日)
 * - 超期费用 = 超期天数 × 合同箱数 × 单价
 * - 缺箱费用 = (合同箱数 − 实际归还箱数) × 单价；未登记归还时不预估缺箱
 */
export function estimateFee(
  contract: RentalContract,
  today = new Date().toISOString().slice(0, 10)
): ContractFee {
  const actualReturnDate = contract.actualReturnDate || undefined
  let lifecycle: ContractLifecycle
  const returned = Boolean(actualReturnDate)
  if (returned) {
    lifecycle = '已归还'
  } else if (toDateValue(today) < toDateValue(contract.rentStart)) {
    lifecycle = '待起租'
  } else if (toDateValue(today) <= toDateValue(contract.rentEnd)) {
    lifecycle = '在租'
  } else {
    lifecycle = '已到期未还'
  }

  const effectiveReturn = actualReturnDate ?? today
  const overdueDays = Math.max(
    0,
    Math.round((toDateValue(effectiveReturn) - toDateValue(contract.rentEnd)) / DAY_MS)
  )
  // 未登记实际归还前不凭空计算超期占用（归还箱数未知）；到期未还时按今天给提示性预估
  const overdueBoxes = returned ? contract.boxCount : lifecycle === '已到期未还' ? contract.boxCount : 0
  const missingBoxes =
    typeof contract.actualReturnBoxes === 'number'
      ? Math.max(0, contract.boxCount - contract.actualReturnBoxes)
      : 0
  const overdueFee = roundMoney(overdueDays * overdueBoxes * contract.unitPrice)
  const missingFee = roundMoney(missingBoxes * contract.unitPrice)
  return {
    contract,
    lifecycle,
    overdueDays,
    overdueBoxes,
    missingBoxes,
    overdueFee,
    missingFee,
    totalFee: roundMoney(overdueFee + missingFee)
  }
}
