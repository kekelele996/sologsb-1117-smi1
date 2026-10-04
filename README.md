# 蜜蜂授粉路线规划器（gbbeeroute）

面向果园托管服务队与蜂场技术员，把「果园地块 → 花期 → 蜂群投放点 → 转场路线」排成季内可执行的授粉安排，解决花期重叠时蜂群撞车、转场距离过远、投放点与地块不匹配的问题。**纯前端单页应用**，全部数据保存在浏览器 IndexedDB，不依赖任何后端服务或外部接口。

## 一、Docker 一键启动（推荐）

```bash
cp .env.example .env      # 首次启动先复制环境变量文件
docker compose up -d --build
```

启动后访问：<http://localhost:21817>

```bash
docker compose ps        # 查看容器状态
docker compose logs -f   # 查看日志
docker compose down      # 停止并移除容器（数据在浏览器本地）
```

`.env` 可调：

```
COMPOSE_PROJECT_NAME=gbbeeroute
FRONTEND_PORT=21817
VITE_AMAP_KEY=            # 可选，留空即自动降级为本地 SVG 网格视图
```

## 二、技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | React 18 |
| 语言 | TypeScript（`tsc --noEmit` 类型检查零错误） |
| UI 组件库 | Ant Design 5 |
| 地图 | 高德地图 JS API 2.0（可选，key 走 `VITE_AMAP_KEY`） |
| 状态管理 | Zustand |
| 路由 | React Router 6（nginx `try_files` 回落） |
| 构建 | Vite 5 |
| 本地存储 | IndexedDB（Dexie 封装，含 `schemaVersion` 与升级迁移） |
| 部署 | 多阶段 Dockerfile：`node:20-alpine` 构建 → `nginx:alpine` 托管 |

## 三、高德地图 Key 与降级策略

- 在 `.env` 里填写 `VITE_AMAP_KEY=<你的 key>` 后**重新构建**（`docker compose up -d --build`），地图将使用高德 JS API 渲染地块、投放点与转场折线；
- **未配置 key 或脚本加载失败时，`RouteMap` 自动降级为本地 SVG 网格视图**：按经纬度线性映射渲染地块、投放点与转场折线，支持点选拾取坐标；
- **构建与运行都不依赖该 key**：未配置 key 时不会注入任何外部脚本（避免无谓请求与报错），Docker 构建零网络依赖即可通过；
- 页面右上角始终显示当前数据源（高德地图 JS API / 本地 SVG 网格视图）。

## 四、本地开发

```bash
cd frontend
npm install
npm run dev        # http://localhost:21817
npm run build      # 类型检查 + 生产构建
```

## 五、目录结构

```
sologsb-1117/
├── docker-compose.yml          # 顶层 name: gbbeeroute，无 version 字段
├── .env.example                # COMPOSE_PROJECT_NAME / FRONTEND_PORT / VITE_AMAP_KEY
├── frontend/
│   ├── Dockerfile              # 多阶段构建，nginx 阶段 chmod -R a+rX 静态资源
│   ├── nginx.conf              # try_files 前端路由回落 + gzip
│   ├── public/favicon.svg
│   └── src/
│       ├── types/              # orchard.ts / colony.ts / droppoint.ts / route.ts / rental.ts / index.ts
│       ├── stores/             # orchardStore / colonyStore / droppointStore / routeStore / rentalContractStore / rentalPlacementStore（Zustand）
│       ├── components/common/  # RouteMap / FlowerWindowBar / StatusTag / CoordPicker
│       ├── hooks/              # useAmap / usePersistentStore
│       ├── pages/              # SchedulePage / OrchardsPage / ColoniesPage / RentalsPage / RoutesPage / ExportPage
│       ├── router/index.tsx
│       └── utils/              # geo.ts / allocation.ts / export.ts / id.ts
```

## 六、数据模型与存储

| 模型 | 说明 | Dexie 表 |
| --- | --- | --- |
| Orchard 果园地块 | 地块名、作物、面积、经纬度、盛花期起止、需蜂强度（箱/亩）、园主联系方式、可达性、历史授粉年份 | `orchards` |
| BeeColony 蜂群 | 群号、蜂种、群势（足框）、箱型、来源（自有/租入，v3）、当前所在地块、状态（待投放/在园/转场中/回场）、最近检查日期、健康备注 | `colonies` |
| DropPoint 投放点 | 所属地块、坐标、编号、可容纳箱数、遮阴条件、水源距离、投放时间窗、撤场时间、责任人、安排群号 | `dropPoints` |
| TransitRoute 转场路线 | 出发/到达投放点、预计里程与耗时、车辆类型、出发时刻、风险备注、实际记录 | `routes` |
| RentalContract 租蜂合同 | 邻县蜂场、合同编号、箱数、起租日、归租日、单价（元/箱·天）、实际归还日期/箱数 | `rentalContracts` |
| RentalPlacement 租蜂投放排单 | 合同、投放地块、箱数、投放起止；同一合同时间重叠不得排两个地块、并发在租不超过合同箱数 | `rentalPlacements` |

- 数据库名 `gbbeeroute`，`meta` 表保存 `schemaVersion`；
- `version(2)` 升级迁移会为历史投放点补齐「可容纳箱数」（默认 8 箱）；
- `version(3)` 新增租蜂合同/投放排单两张表，蜂群新增「来源」字段：**历史数据没有租借来源，升级后统一按「自有群」补齐，自有群不产生租蜂费用**；
- 数据仅存于浏览器本地，容器无状态、不挂载命名卷。

## 七、主要页面

| 路由 | 功能 |
| --- | --- |
| `/` | 季内授粉安排总表：花期条带 + 已投放群体（含租入在租箱数），冲突（同一蜂群被排入花期重叠的不同地块）标红并汇总 |
| `/orchards` | 果园地块管理：面积与需蜂强度自动算建议箱数、可达性标记、花期重叠提示、投放点维护（含坐标拾取） |
| `/colonies` | 蜂群台账：按群势/状态/来源筛选，批量改状态、批量记录检查备注 |
| `/rentals` | 租蜂补缺口与费用：地块缺口重算、租蜂合同登记、按合同箱数补缺口排单、到期归还登记、费用预估（技术员可编辑 / 托管队只读，角色切换持久化在 localStorage） |
| `/routes` | 转场路线规划：地图依次选点生成顺序与里程，拖动或上下移动调整顺序并实时重算，写回路线表 |
| `/export` | 导出授粉安排清单 / 租蜂投放排单 / 租蜂费用预估 / 转场路线表（CSV）、全量 JSON 备份，并提供横向/纵向打印视图 |

## 八、计算约定

- 建议箱数 = ⌈面积(亩) × 需蜂强度(箱/亩)⌉，最少 1 箱；
- **地块用蜂缺口** = max(0, 建议箱数 − 自有在租箱数 − 租入在租箱数)；自有在租取「投放点群号 + 蜂群当前所在地块」去重，租入在租取盛花期内排单的**最大并发箱数**（错峰排同一地块不重复计数）；
- **在租箱数** = 当天落在各投放排单区间内的箱数合计；地块花期、需蜂强度或投放点容量改动后，缺口/在租随 store 数据由纯函数（`utils/allocation.ts`）自动重算；
- 投放点容量超限：盛花期内最大在园箱数（自有 + 租入）超过该地块投放点容量合计时标红；
- **费用预估（托管队只读，全部由合同与归还数据派生）**：
  - 在租天数 = 归租日 − 起租日 + 1（含首尾）；
  - 基础租金 = 合同箱数 × 在租天数 × 单价；
  - 超期天数 = 实际归还日 − 归租日（归还日计入，归租日当天归还不算超期）；超期费 = 合同箱数 × 超期天数 × 单价；
  - 缺箱数 = 合同箱数 − 实际归还箱数；缺箱赔偿 = 缺箱数 × 在租天数 × 单价；
  - 未登记归还时按当天日期滚动预估（已过归租日即计提超期费）；
- 转场里程按 Haversine 球面距离累计，耗时按平均 32 km/h + 0.25 h 装卸估算；
- 花期重叠：两地块盛花期区间交集天数 ≥ 1 即视为重叠；同一群号在重叠期内被排入两个地块 → 冲突。
