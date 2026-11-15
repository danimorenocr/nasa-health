import Panel from './Panel'
import Skeleton, { SkeletonGroup } from './Skeleton'

function Card({ height = 160, lines = 2, className = '' }) {
  return (
    <Panel className={`page-skeleton__card ${className}`} style={{ minHeight: height }}>
      <Skeleton w="38%" h={14} />
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} w={index === 0 ? '72%' : '55%'} h={index === 0 ? 24 : 12} />
      ))}
      {height > 140 && <Skeleton w="100%" h={Math.max(40, height - 112)} radius="10px" />}
    </Panel>
  )
}

function Header() {
  return <div className="page-skeleton__header"><Skeleton w="min(320px, 65%)" h={34} /><Skeleton w="min(440px, 80%)" h={12} /></div>
}

function Pills({ count = 4 }) {
  return <div className="page-skeleton__pills">{Array.from({ length: count }, (_, index) => <Skeleton key={index} w={100} h={35} radius="18px" />)}</div>
}

export default function PageSkeleton({ page, tr = (spanish) => spanish }) {
  return (
    <SkeletonGroup label={tr('Cargando sección…', 'Loading section…')} className="page-skeleton">
      {page !== 'Mind Tracker' && <Header />}


      {page === 'Mind Tracker' && <>
        <div className="page-skeleton__grid page-skeleton__grid--mind"><Card height={390} /><Card height={390} /><Card height={390} /></div>
        <div className="page-skeleton__grid page-skeleton__grid--two"><Card height={320} /><Card height={320} /></div>
      </>}

      {page === 'Body Explorer' && <>
        <div className="page-skeleton__grid page-skeleton__grid--body"><Card height={560} /><Card height={560} className="page-skeleton__model" /><Card height={560} /></div>
        <Card height={130} />
      </>}

      {page === 'Smart Alerts' && <>
        <div className="page-skeleton__grid page-skeleton__grid--four">{[0, 1, 2, 3].map((index) => <Card key={index} height={125} lines={1} />)}</div>
        <div className="page-skeleton__grid page-skeleton__grid--alerts"><Card height={400} /><Card height={400} /></div>
      </>}

      {page === 'Mission Challenges' && <><Card height={210} /><Card height={150} /><Card height={220} /></>}

      {page === 'Wellness Guide' && <><Card height={200} /><Card height={260} /><Card height={230} /><div className="page-skeleton__grid page-skeleton__grid--two"><Card height={180} /><Card height={180} /></div></>}
    </SkeletonGroup>
  )
}
