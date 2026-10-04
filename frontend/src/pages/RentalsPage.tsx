import { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message
} from 'antd'
import dayjs from 'dayjs'
import type { RentalContract, RentalPlacement } from '@/types'
import { contractStatus, estimateFee, inclusiveDays } from '@/types'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { orchardStore } from '@/stores/orchardStore'
import { colonyStore } from '@/stores/colonyStore'
import { droppointStore } from '@/stores/droppointStore'
import { rentalContractStore } from '@/stores/rentalContractStore'
import { rentalPlacementStore } from '@/stores/rentalPlacementStore'
import { computeGapTable, maxConcurrentBoxes, rentedOutBoxes } from '@/utils/allocation'
import { uid } from '@/utils/id'

type Role = 'tech' | 'team'

interface ContractFormValues {
  code: string
  apiaryName: string
  contact: string
  boxCount: number
  rentRange: [dayjs.Dayjs, dayjs.Dayjs]
  unitPrice: number
  note: string
}

interface PlacementFormValues {
  orchardId: string
  boxCount: number
  range: [dayjs.Dayjs, dayjs.Dayjs]
}

interface ReturnFormValues {
  actualReturnDate: dayjs.Dayjs
  actualReturnBoxes: number
}

/** 租蜂补缺口：合同登记、按箱补缺口排单、归还登记与费用预估 */
export default function RentalsPage(): JSX.Element {
  const [role, setRole] = useRole()
  const readonly = role === 'team'

  const orchards = usePersistentStore(orchardStore, (state) => state.rows)
  const colonies = usePersistentStore(colonyStore, (state) => state.rows)
  const dropPoints = usePersistentStore(droppointStore, (state) => state.rows)
  const contracts = usePersistentStore(rentalContractStore, (state) => state.rows)
  const placements = usePersistentStore(rentalPlacementStore, (state) => state.rows)

  const [contractModal, setContractModal] = useState(false)
  const [editingContract, setEditingContract] = useState<RentalContract | null>(null)
  const [contractForm] = Form.useForm<ContractFormValues>()

  const [placementModal, setPlacementModal] = useState(false)
  const [placementContract, setPlacementContract] = useState<RentalContract | null>(null)
  const [placementForm] = Form.useForm<PlacementFormValues>()

  const [returnModal, setReturnModal] = useState(false)
  const [returnContract, setReturnContract] = useState<RentalContract | null>(null)
  const [returnForm] = Form.useForm<ReturnFormValues>()

  const today = dayjs().format('YYYY-MM-DD')

  /** 缺口表：地块花期或投放点容量改动后，随 store 数据自动重算 */
  const gapTable = useMemo(
    () => computeGapTable(orchards, colonies, dropPoints, placements),
    [orchards, colonies, dropPoints, placements]
  )

  const orchardById = useMemo(() => new Map(orchards.map((item) => [item.id, item])), [orchards])

  const totalGap = gapTable.reduce((sum, row) => sum + row.gap, 0)
  const totalRentedToday = contracts.reduce(
    (sum, contract) => sum + rentedOutBoxes(placements, contract.id, today),
    0
  )
  const totalFee = contracts.reduce((sum, contract) => sum + estimateFee(contract, today).totalFee, 0)

  function openContractCreate(): void {
    setEditingContract(null)
    contractForm.setFieldsValue({
      code: `ZL-${dayjs().year()}-${String(contracts.length + 1).padStart(2, '0')}`,
      apiaryName: '',
      contact: '',
      boxCount: 10,
      rentRange: [dayjs().add(1, 'day'), dayjs().add(15, 'day')],
      unitPrice: 2.5,
      note: ''
    })
    setContractModal(true)
  }

  function openContractEdit(contract: RentalContract): void {
    setEditingContract(contract)
    contractForm.setFieldsValue({
      code: contract.code,
      apiaryName: contract.apiaryName,
      contact: contract.contact,
      boxCount: contract.boxCount,
      rentRange: [dayjs(contract.rentStart), dayjs(contract.rentEnd)],
      unitPrice: contract.unitPrice,
      note: contract.note
    })
    setContractModal(true)
  }

  async function submitContract(): Promise<void> {
    const values = await contractForm.validateFields()
    const boxCount = Number(values.boxCount) || 0
    const rentStart = values.rentRange[0].format('YYYY-MM-DD')
    const rentEnd = values.rentRange[1].format('YYYY-MM-DD')
    if (editingContract) {
      const usedPeak = peakOfContract(placements, editingContract.id)
      if (boxCount < usedPeak) {
        message.error(`该合同排单最大在租 ${usedPeak} 箱，合同箱数不能低于该值`)
        return
      }
      const outside = placements
        .filter((item) => item.contractId === editingContract.id)
        .some((item) => item.startDate < rentStart || item.endDate > rentEnd)
      if (outside) {
        message.error('已有投放排单落在新租期之外，请先撤销或调整相关排单')
        return
      }
    }
    const row: RentalContract = {
      id: editingContract?.id ?? uid('rc'),
      code: values.code.trim(),
      apiaryName: values.apiaryName.trim(),
      contact: values.contact?.trim() ?? '',
      boxCount,
      rentStart,
      rentEnd,
      unitPrice: Number(values.unitPrice) || 0,
      note: values.note?.trim() ?? '',
      actualReturnDate: editingContract?.actualReturnDate ?? '',
      actualReturnBoxes: editingContract?.actualReturnBoxes ?? null
    }
    await rentalContractStore.getState().save(row)
    message.success(`合同「${row.code}」已保存`)
    setContractModal(false)
  }

  async function removeContract(contract: RentalContract): Promise<void> {
    const related = placements.filter((item) => item.contractId === contract.id)
    if (related.length > 0) {
      await rentalPlacementStore.getState().removeByContract(contract.id)
    }
    await rentalContractStore.getState().remove(contract.id)
    message.success(`合同「${contract.code}」及其 ${related.length} 条排单已删除`)
  }

  /** 在某份合同上为指定地块补缺口：默认时间取地块盛花期与合同租期的交集（无交集则退回整个租期） */
  function openPlacementCreate(contract: RentalContract, orchardId?: string): void {
    setPlacementContract(contract)
    const usedPeak = peakOfContract(placements, contract.id)
    const available = Math.max(0, contract.boxCount - usedPeak)
    const target = orchardId ? orchardById.get(orchardId) : undefined
    const start = target ? laterOf(contract.rentStart, target.bloomStart) : contract.rentStart
    const end = target ? earlierOf(contract.rentEnd, target.bloomEnd) : contract.rentEnd
    const intersects = start <= end
    const gapOfTarget = target ? gapTable.find((item) => item.orchardId === target.id)?.gap ?? available : available
    const defaultOrchard =
      target?.id ??
      orchards.find((item) => gapTable.some((gapRow) => gapRow.orchardId === item.id && gapRow.gap > 0))?.id
    placementForm.setFieldsValue({
      orchardId: defaultOrchard,
      boxCount: Math.min(available || contract.boxCount, gapOfTarget || available || contract.boxCount),
      range: intersects
        ? [dayjs(start), dayjs(end)]
        : [dayjs(contract.rentStart), dayjs(contract.rentEnd)]
    })
    setPlacementModal(true)
  }

  async function submitPlacement(): Promise<void> {
    if (!placementContract) return
    const values = await placementForm.validateFields()
    const row: RentalPlacement = {
      id: uid('rp'),
      contractId: placementContract.id,
      orchardId: values.orchardId,
      boxCount: Number(values.boxCount) || 0,
      startDate: values.range[0].format('YYYY-MM-DD'),
      endDate: values.range[1].format('YYYY-MM-DD')
    }
    const result = await rentalPlacementStore
      .getState()
      .saveChecked(row, placementContract.boxCount, placementContract.rentStart, placementContract.rentEnd)
    if (!result.ok) {
      message.error(result.message)
      return
    }
    message.success(`已按合同「${placementContract.code}」向${orchardById.get(row.orchardId)?.name ?? '地块'}投放 ${row.boxCount} 箱`)
    setPlacementModal(false)
  }

  function openReturn(contract: RentalContract): void {
    setReturnContract(contract)
    returnForm.setFieldsValue({
      actualReturnDate: dayjs(),
      actualReturnBoxes: contract.boxCount
    })
    setReturnModal(true)
  }

  async function submitReturn(): Promise<void> {
    if (!returnContract) return
    const values = await returnForm.validateFields()
    await rentalContractStore
      .getState()
      .registerReturn(
        returnContract.id,
        values.actualReturnDate.format('YYYY-MM-DD'),
        Number(values.actualReturnBoxes) || 0
      )
    message.success(`合同「${returnContract.code}」归还已登记，费用预估已更新`)
    setReturnModal(false)
  }

  const gapColumns = [
    {
      title: '地块',
      key: 'orchard',
      render: (_: unknown, row: (typeof gapTable)[number]) => {
        const orchard = orchardById.get(row.orchardId)
        return orchard ? `${orchard.name}（${orchard.crop} ${orchard.bloomStart}~${orchard.bloomEnd}）` : row.orchardId
      }
    },
    { title: '需蜂箱数', dataIndex: 'demand', key: 'demand', width: 100 },
    { title: '自有在租', dataIndex: 'ownBoxes', key: 'own', width: 100 },
    { title: '租入在租', dataIndex: 'rentedBoxes', key: 'rented', width: 100 },
    {
      title: '缺口',
      dataIndex: 'gap',
      key: 'gap',
      width: 100,
      render: (value: number) => (value > 0 ? <Tag color="red">{value} 箱</Tag> : <Tag color="green">已补齐</Tag>)
    },
    {
      title: '投放点容量',
      key: 'cap',
      width: 120,
      render: (_: unknown, row: (typeof gapTable)[number]) =>
        row.capacityExceeded ? <Tag color="red">{row.capacity} 箱（超容）</Tag> : <Tag>{row.capacity} 箱</Tag>
    },
    {
      title: '补缺口',
      key: 'action',
      width: 160,
      render: (_: unknown, row: (typeof gapTable)[number]) => {
        if (readonly || row.gap <= 0) return '—'
        const usable = contracts.filter((contract) => contractStatus(contract, today) !== '已归还')
        return usable.length > 0 ? (
          <SelectContractForGap
            contracts={usable}
            onPick={(contract) => openPlacementCreate(contract, row.orchardId)}
          />
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            无可租合同
          </Typography.Text>
        )
      }
    }
  ]

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2 className="page-title">租蜂补缺口与费用预估</h2>
          <p className="page-sub">
            按地块花期与需蜂强度计算用蜂缺口，自有群不足时用邻县租蜂合同按箱补上；同一份合同不能同时排在两个地块。
            到期前登记实际归还，超期与缺箱按合同单价折成费用，托管队只读费用预估。
          </p>
        </div>
        <Space>
          <Segmented
            value={role}
            onChange={(value) => setRole(value as Role)}
            options={[
              { label: '蜂场技术员（可编辑）', value: 'tech' },
              { label: '托管队（只读费用）', value: 'team' }
            ]}
          />
          {!readonly ? (
            <Button type="primary" onClick={openContractCreate}>
              登记租蜂合同
            </Button>
          ) : null}
        </Space>
      </div>

      {readonly ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="当前为托管队视图：合同、投放排单与归还登记均不可编辑，本页仅展示缺口与费用预估。"
        />
      ) : null}

      <Row gutter={16} style={{ marginBottom: 12 }}>
        <Col xs={24} md={8}>
          <Card size="small">
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              地块用蜂缺口合计
            </Typography.Text>
            <div style={{ fontSize: 26, fontWeight: 600, color: totalGap > 0 ? '#cf4040' : '#3a9d5d' }}>{totalGap} 箱</div>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small">
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              今日在租箱数（各合同排单合计）
            </Typography.Text>
            <div style={{ fontSize: 26, fontWeight: 600, color: '#1d6fb8' }}>{totalRentedToday} 箱</div>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small">
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              费用预估合计（基础租金 + 超期 + 缺箱）
            </Typography.Text>
            <div style={{ fontSize: 26, fontWeight: 600, color: '#d48806' }}>¥ {totalFee.toFixed(2)}</div>
          </Card>
        </Col>
      </Row>

      <Card size="small" title="各地块用蜂缺口（花期、需蜂强度或投放点容量改动后自动重算）" style={{ marginBottom: 16 }}>
        <Table dataSource={gapTable} rowKey="orchardId" pagination={false} size="small" columns={gapColumns} />
      </Card>

      <Card size="small" title={`租蜂合同与费用预估（${contracts.length} 份）`}>
        <Table<RentalContract>
          dataSource={contracts}
          rowKey="id"
          pagination={false}
          size="small"
          expandable={{
            expandedRowRender: (contract) => (
              <PlacementPanel
                contract={contract}
                placements={placements.filter((item) => item.contractId === contract.id)}
                orchardName={(id) => orchardById.get(id)?.name ?? '未知地块'}
                readonly={readonly}
                onAdd={() => openPlacementCreate(contract)}
              />
            )
          }}
          columns={[
            { title: '合同编号', dataIndex: 'code', key: 'code', width: 130 },
            { title: '邻县蜂场', dataIndex: 'apiaryName', key: 'apiary' },
            { title: '联系方式', dataIndex: 'contact', key: 'contact', width: 170, render: (v: string) => v || '—' },
            { title: '箱数', dataIndex: 'boxCount', key: 'boxes', width: 70 },
            {
              title: '租期',
              key: 'term',
              width: 200,
              render: (_, record) => `${record.rentStart} ~ ${record.rentEnd}（${inclusiveDays(record.rentStart, record.rentEnd)} 天）`
            },
            {
              title: '单价',
              dataIndex: 'unitPrice',
              key: 'price',
              width: 110,
              render: (value: number) => `¥ ${value}/箱·天`
            },
            {
              title: '在租/状态',
              key: 'status',
              width: 150,
              render: (_, record) => {
                const status = contractStatus(record, today)
                const color = status === '在租' ? 'blue' : status === '已到期未还' ? 'red' : status === '未起租' ? 'default' : 'green'
                const outNow = rentedOutBoxes(placements, record.id, today)
                return (
                  <Space direction="vertical" size={0}>
                    <Tag color={color}>{status}</Tag>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      今日在租 {outNow} / {record.boxCount} 箱
                    </Typography.Text>
                  </Space>
                )
              }
            },
            {
              title: '归还登记',
              key: 'return',
              width: 200,
              render: (_, record) =>
                record.actualReturnDate ? (
                  <Space direction="vertical" size={0}>
                    <Typography.Text>{record.actualReturnDate} 归还</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      实际 {record.actualReturnBoxes ?? 0} 箱
                      {estimateFee(record, today).missingBoxes > 0 ? `，缺 ${estimateFee(record, today).missingBoxes} 箱` : ''}
                    </Typography.Text>
                  </Space>
                ) : (
                  <Typography.Text type="secondary">未登记</Typography.Text>
                )
            },
            {
              title: '费用预估（只读）',
              key: 'fee',
              width: 260,
              render: (_, record) => <FeeBreakdown contract={record} today={today} />
            },
            {
              title: '操作',
              key: 'action',
              width: 200,
              render: (_, record) =>
                readonly ? (
                  '—'
                ) : (
                  <Space size={4}>
                    <Button size="small" type="link" onClick={() => openPlacementCreate(record)}>
                      补缺口
                    </Button>
                    {!record.actualReturnDate ? (
                      <Button size="small" type="link" onClick={() => openReturn(record)}>
                        归还登记
                      </Button>
                    ) : null}
                    <Button size="small" type="link" onClick={() => openContractEdit(record)}>
                      编辑
                    </Button>
                    <Popconfirm title="删除该合同及其全部排单？" onConfirm={() => void removeContract(record)}>
                      <Button size="small" type="link" danger>
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                )
            }
          ]}
        />
      </Card>

      <Modal
        title={editingContract ? '编辑租蜂合同' : '登记租蜂合同'}
        open={contractModal}
        onCancel={() => setContractModal(false)}
        onOk={() => void submitContract()}
        width={680}
        okText="保存"
      >
        <Form form={contractForm} layout="vertical">
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="code" label="合同编号" rules={[{ required: true, message: '请填写合同编号' }]}>
                <Input placeholder="如 ZL-2026-01" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="apiaryName" label="邻县蜂场" rules={[{ required: true, message: '请填写邻县蜂场名称' }]}>
                <Input placeholder="如 陇县益农蜂场" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="contact" label="联系方式">
                <Input placeholder="联系人/电话" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="boxCount" label="合同箱数" rules={[{ required: true }]}>
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="unitPrice" label="合同单价（元/箱·天）" rules={[{ required: true }]}>
                <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="rentRange" label="起租日 ~ 归租日" rules={[{ required: true, message: '请选择租期' }]}>
                <DatePicker.RangePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="note" label="合同备注">
                <Input.TextArea rows={2} placeholder="蜂种、运输方式、结算说明等" />
              </Form.Item>
            </Col>
          </Row>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            费用口径：基础租金 = 箱数 × 在租天数 × 单价；实际归还晚于归租日按超期天数折费；归还箱数不足时，缺箱按整个在租期折赔偿。
          </Typography.Text>
        </Form>
      </Modal>

      <Modal
        title={`按合同补缺口排单 · ${placementContract?.code ?? ''}`}
        open={placementModal}
        onCancel={() => setPlacementModal(false)}
        onOk={() => void submitPlacement()}
        width={560}
        okText="保存排单"
      >
        <Form form={placementForm} layout="vertical">
          <Form.Item name="orchardId" label="投放地块" rules={[{ required: true, message: '请选择地块' }]}>
            <Select
              style={{ width: '100%' }}
              options={orchards.map((item) => {
                const gap = gapTable.find((row) => row.orchardId === item.id)
                return {
                  value: item.id,
                  label: `${item.name}（${item.crop} 花期 ${item.bloomStart}~${item.bloomEnd}，缺口 ${gap?.gap ?? 0} 箱）`
                }
              })}
            />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="boxCount" label="投放箱数（按合同箱数补缺口）" rules={[{ required: true }]}>
                <InputNumber min={1} max={placementContract?.boxCount} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="range" label="投放起止（须在合同租期内）" rules={[{ required: true }]}>
                <DatePicker.RangePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            校验：同一合同在时间重叠时不能排往两个地块；并发在租箱数不得超过合同箱数。
          </Typography.Text>
        </Form>
      </Modal>

      <Modal
        title={`归还登记 · ${returnContract?.code ?? ''}`}
        open={returnModal}
        onCancel={() => setReturnModal(false)}
        onOk={() => void submitReturn()}
        width={480}
        okText="登记归还"
      >
        <Form form={returnForm} layout="vertical">
          <Alert
            style={{ marginBottom: 12 }}
            type="warning"
            showIcon
            message={`归租日 ${returnContract?.rentEnd ?? ''}；晚于归租日归还将按单价折超期费，归还箱数不足 ${returnContract?.boxCount ?? 0} 箱的部分按缺箱折赔偿。`}
          />
          <Form.Item name="actualReturnDate" label="实际归还日期" rules={[{ required: true, message: '请选择实际归还日期' }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="actualReturnBoxes" label="实际归还箱数" rules={[{ required: true }]}>
            <InputNumber min={0} max={returnContract?.boxCount} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

/** 费用拆分（托管队只读） */
function FeeBreakdown({ contract, today }: { contract: RentalContract; today: string }): JSX.Element {
  const fee = estimateFee(contract, today)
  return (
    <Space direction="vertical" size={0}>
      <Typography.Text strong style={{ color: '#d48806' }}>
        合计 ¥ {fee.totalFee.toFixed(2)}
      </Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        租金 ¥{fee.baseFee.toFixed(2)}
        {fee.overdueFee > 0 ? ` · 超期 ${fee.overdueDays} 天 ¥${fee.overdueFee.toFixed(2)}` : ''}
        {fee.missingFee > 0 ? ` · 缺 ${fee.missingBoxes} 箱 ¥${fee.missingFee.toFixed(2)}` : ''}
      </Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        {fee.settled ? '按实际归还结算' : '未归还，按今日预估'}
      </Typography.Text>
    </Space>
  )
}

/** 合同展开行：该合同的投放排单明细 */
function PlacementPanel({
  contract,
  placements,
  orchardName,
  readonly,
  onAdd
}: {
  contract: RentalContract
  placements: RentalPlacement[]
  orchardName: (id: string) => string
  readonly: boolean
  onAdd: () => void
}): JSX.Element {
  return (
    <div style={{ padding: '8px 0' }}>
      <Space style={{ marginBottom: 8 }}>
        <Typography.Text strong style={{ fontSize: 13 }}>
          投放排单（{placements.length} 条）
        </Typography.Text>
        {!readonly ? (
          <Button size="small" onClick={onAdd}>
            新增排单
          </Button>
        ) : null}
      </Space>
      <Table<RentalPlacement>
        dataSource={placements}
        rowKey="id"
        size="small"
        pagination={false}
        locale={{ emptyText: '该合同尚无排单' }}
        columns={[
          { title: '地块', key: 'orchard', render: (_, record) => orchardName(record.orchardId) },
          { title: '箱数', dataIndex: 'boxCount', key: 'boxes', width: 80 },
          { title: '投放起', dataIndex: 'startDate', key: 'start', width: 120 },
          { title: '投放止', dataIndex: 'endDate', key: 'end', width: 120 },
          {
            title: '操作',
            key: 'action',
            width: 80,
            render: (_, record) =>
              readonly ? (
                '—'
              ) : (
                <Button size="small" type="link" danger onClick={() => void rentalPlacementStore.getState().remove(record.id)}>
                  撤销排单
                </Button>
              )
          }
        ]}
      />
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        合同 {contract.boxCount} 箱 · 当前最大在租 {peakOfContract(placements, contract.id)} 箱
        {contract.actualReturnDate ? ` · 已于 ${contract.actualReturnDate} 登记归还` : ''}
      </Typography.Text>
    </div>
  )
}

/** 缺口行内选合同下拉（选择后自动复位，仅列尚有空闲箱数的合同） */
function SelectContractForGap({
  contracts,
  onPick
}: {
  contracts: RentalContract[]
  onPick: (contract: RentalContract) => void
}): JSX.Element {
  const placements = usePersistentStore(rentalPlacementStore, (state) => state.rows)
  const [value, setValue] = useState<string | undefined>(undefined)
  return (
    <Select
      style={{ width: 150 }}
      size="small"
      placeholder="选合同补缺口"
      value={value}
      allowClear
      onChange={(id?: string) => {
        setValue(undefined)
        if (!id) return
        const contract = contracts.find((item) => item.id === id)
        if (contract) onPick(contract)
      }}
      options={contracts.map((contract) => ({
        value: contract.id,
        label: `${contract.code}（闲 ${Math.max(0, contract.boxCount - peakOfContract(placements, contract.id))} 箱）`
      }))}
    />
  )
}

/** 角色切换（localStorage 持久化，两个角色各改各的，互不可改对方数据） */
function useRole(): [Role, (role: Role) => void] {
  const [role, setRoleState] = useState<Role>(() => (localStorage.getItem('gbbeeroute-role') === 'team' ? 'team' : 'tech'))
  const setRole = (next: Role): void => {
    localStorage.setItem('gbbeeroute-role', next)
    setRoleState(next)
  }
  return [role, setRole]
}

/** 一份合同排单的最大并发在租箱数 */
function peakOfContract(placements: RentalPlacement[], contractId: string): number {
  const own = placements.filter((item) => item.contractId === contractId)
  if (own.length === 0) return 0
  const starts = own.map((item) => item.startDate).sort()
  const ends = own.map((item) => item.endDate).sort()
  return maxConcurrentBoxes(
    own.map((item) => ({ start: item.startDate, end: item.endDate, boxes: item.boxCount })),
    starts[0],
    ends[ends.length - 1]
  )
}

function laterOf(a: string, b: string): string {
  return a >= b ? a : b
}

function earlierOf(a: string, b: string): string {
  return a <= b ? a : b
}
