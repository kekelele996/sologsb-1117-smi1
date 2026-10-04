/** 租蜂合同状态（由日期与归还登记派生，不持久化） */
export type ContractLifecycle = '待起租' | '在租' | '已到期未还' | '已归还'

/** RentalContract 租蜂合同（蜂场技术员维护，邻县蜂场租入） */
export interface RentalContract {
  id: string
  /** 合同编号，如 ZL-2026-01 */
  code: string
  /** 出租方（邻县蜂场）名称 */
  supplier: string
  /** 合同箱数 */
  boxCount: number
  /** 起租日 YYYY-MM-DD */
  rentStart: string
  /** 归租日（计划归还日）YYYY-MM-DD */
  rentEnd: string
  /** 合同单价（元/箱/天）：超期占用与缺箱折价均按此单价计 */
  unitPrice: number
  /** 联系人与电话 */
  contact: string
  /** 实际归还日期（到期前由技术员登记），未登记为空 */
  actualReturnDate?: string
  /** 实际归还箱数，未登记为空 */
  actualReturnBoxes?: number
  note: string
}

/** ContractAssignment 合同投放排段：同一合同在一段日期内投放至某地块 */
export interface ContractAssignment {
  id: string
  contractId: string
  orchardId: string
  /** 该合同投放在该地块的箱数 */
  boxes: number
  /** 投放起日（含，落在花期与租期内）YYYY-MM-DD */
  startDate: string
  /** 投放止日（含）YYYY-MM-DD */
  endDate: string
}

/** 费用预估（由合同与归还登记派生，托管队只读） */
export interface ContractFee {
  contract: RentalContract
  lifecycle: ContractLifecycle
  /** 超期天数（实际/预估归还日晚于归租日的天数） */
  overdueDays: number
  /** 计超期费用的箱数（已还按在租合同箱数；未还且未登记按 0，避免凭空计费） */
  overdueBoxes: number
  /** 缺的箱数 = 合同箱数 - 实际归还箱数 */
  missingBoxes: number
  /** 超期费用 = 超期天数 × 箱数 × 单价 */
  overdueFee: number
  /** 缺箱费用 = 缺的箱数 × 单价 */
  missingFee: number
  totalFee: number
}
