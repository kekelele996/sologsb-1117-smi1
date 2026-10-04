import { create } from 'zustand'
import type { RentalPlacement } from '@/types'
import { dateRangesOverlap } from '@/types'
import { db, deleteRow, loadAll, putRow } from '@/hooks/usePersistentStore'
import { maxConcurrentBoxes } from '@/utils/allocation'

/** 投放排单校验结果 */
export interface PlacementCheck {
  ok: boolean
  message?: string
}

export interface RentalPlacementState {
  rows: RentalPlacement[]
  loaded: boolean
  hydrate: () => Promise<void>
  /** 带业务校验地保存排单：合同箱数上限、合同租期、同合同同期不排两个地块 */
  saveChecked: (row: RentalPlacement, contractBoxes: number, rentStart: string, rentEnd: string) => Promise<PlacementCheck>
  remove: (id: string) => Promise<void>
  removeByContract: (contractId: string) => Promise<void>
}

export const rentalPlacementStore = create<RentalPlacementState>((set, get) => ({
  rows: [],
  loaded: false,
  hydrate: async () => {
    const rows = await loadAll<RentalPlacement>(db.rentalPlacements)
    rows.sort((a, b) => a.startDate.localeCompare(b.startDate))
    set({ rows, loaded: true })
  },
  saveChecked: async (row, contractBoxes, rentStart, rentEnd) => {
    if (row.boxCount <= 0) return { ok: false, message: '投放箱数必须大于 0' }
    if (!row.startDate || !row.endDate || row.startDate > row.endDate) {
      return { ok: false, message: '投放起止日期不合法' }
    }
    if (row.startDate < rentStart || row.endDate > rentEnd) {
      return { ok: false, message: `投放时间须落在合同租期内（${rentStart} ~ ${rentEnd}）` }
    }
    const sameContract = get().rows.filter(
      (item) => item.contractId === row.contractId && item.id !== row.id
    )
    // 同一份合同不得同时排在两个地块：允许错峰（日期不重叠）排不同地块
    const clash = sameContract.find(
      (item) => item.orchardId !== row.orchardId && dateRangesOverlap(item.startDate, item.endDate, row.startDate, row.endDate)
    )
    if (clash) {
      return { ok: false, message: `同一份合同在 ${row.startDate} ~ ${row.endDate} 已排往其他地块，不能同时排在两个地块` }
    }
    // 同一时间在租箱数不得超过合同箱数（按日期扫端点取最大并发，允许错峰）
    const concurrent = sameContract.filter((item) => dateRangesOverlap(item.startDate, item.endDate, row.startDate, row.endDate))
    const peak = maxConcurrentBoxes(
      [
        ...concurrent.map((item) => ({ start: item.startDate, end: item.endDate, boxes: item.boxCount })),
        { start: row.startDate, end: row.endDate, boxes: row.boxCount }
      ],
      row.startDate,
      row.endDate
    )
    if (peak > contractBoxes) {
      return { ok: false, message: `排单后最大并发在租 ${peak} 箱已超过合同箱数 ${contractBoxes} 箱` }
    }
    await putRow<RentalPlacement>(db.rentalPlacements, row)
    await get().hydrate()
    return { ok: true }
  },
  remove: async (id) => {
    await deleteRow<RentalPlacement>(db.rentalPlacements, id)
    await get().hydrate()
  },
  removeByContract: async (contractId) => {
    const targets = get().rows.filter((row) => row.contractId === contractId)
    await Promise.all(targets.map((row) => deleteRow<RentalPlacement>(db.rentalPlacements, row.id)))
    await get().hydrate()
  }
}))
