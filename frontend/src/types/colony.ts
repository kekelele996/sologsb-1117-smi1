/** 蜂群来源：自有群或邻县蜂场租入群 */
export const COLONY_SOURCES = ['自有', '租借'] as const
export type ColonySource = (typeof COLONY_SOURCES)[number]

/** 蜂种 */
export const BEE_SPECIES = ['意蜂', '中蜂'] as const
export type BeeSpecies = (typeof BEE_SPECIES)[number]

/** 蜂群状态 */
export const COLONY_STATUSES = ['待投放', '在园', '转场中', '回场'] as const
export type ColonyStatus = (typeof COLONY_STATUSES)[number]

/** 箱型 */
export const BOX_TYPES = ['标准继箱', '平箱', '交尾箱'] as const
export type BoxType = (typeof BOX_TYPES)[number]

/** BeeColony 蜂群 */
export interface BeeColony {
  id: string
  /** 群号 */
  code: string
  species: BeeSpecies
  /** 群势（足框数） */
  strengthFrames: number
  boxType: BoxType
  /** 当前所在地块 */
  currentOrchardId: string
  status: ColonyStatus
  /** 最近检查日期 */
  lastCheckDate: string
  /** 蜂群健康备注 */
  healthNote: string
  /** 蜂群来源：v3 升级前的历史数据按「自有」补齐，不产生租蜂费用 */
  source: ColonySource
  /** 来源为「租借」时关联的租蜂合同 */
  rentalContractId?: string
}
