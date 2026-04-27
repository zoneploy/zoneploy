import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Logo } from '@/components/Logo'
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher'

export function TermsPage() {
  const { t } = useTranslation()

  return (
    <div className="min-h-screen bg-waves bg-cover bg-center">
      <div className="min-h-screen bg-background/80 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-6 py-12">
          {/* Header */}
          <div className="flex items-center justify-between mb-10">
            <Logo />
            <div className="flex items-center gap-3">
              <LanguageSwitcher />
              <Link
                to="/login"
                className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
              >
                <ArrowLeft size={14} />
                {t('legal.backToLogin')}
              </Link>
            </div>
          </div>

          {/* Content */}
          <div className="bg-background-paper rounded-4xl shadow-darker-xs p-10">
            <h1 className="text-2xl font-bold text-text-primary mb-1">{t('legal.terms.title')}</h1>
            <p className="text-sm text-text-secondary mb-8">{t('legal.terms.updated')}</p>

            <Section title={t('legal.terms.s1_title')}>
              {t('legal.terms.s1_body')}
            </Section>

            <Section title={t('legal.terms.s2_title')}>
              {t('legal.terms.s2_body')}
            </Section>

            <Section title={t('legal.terms.s3_title')}>
              <p className="mb-2">{t('legal.terms.s3_intro')}</p>
              <BulletList items={t('legal.terms.s3_items', { returnObjects: true }) as string[]} />
            </Section>

            <Section title={t('legal.terms.s4_title')}>
              {t('legal.terms.s4_body')}
            </Section>

            <Section title={t('legal.terms.s5_title')}>
              <p className="mb-2">{t('legal.terms.s5_intro')}</p>
              <BulletList items={t('legal.terms.s5_items', { returnObjects: true }) as string[]} />
            </Section>

            <Section title={t('legal.terms.s6_title')}>
              {t('legal.terms.s6_body')}
            </Section>

            <Section title={t('legal.terms.s7_title')}>
              {t('legal.terms.s7_body')}
            </Section>

            <Section title={t('legal.terms.s8_title')}>
              {t('legal.terms.s8_body')}
            </Section>

            <Section title={t('legal.terms.s9_title')}>
              {t('legal.terms.s9_body')}
            </Section>

            <Section title={t('legal.terms.s10_title')}>
              {t('legal.terms.s10_body')}
            </Section>

            <Section title={t('legal.terms.s11_title')}>
              {t('legal.terms.s11_body')}
            </Section>

            <Section title={t('legal.terms.s12_title')} last>
              {t('legal.terms.s12_body')}{' '}
              <a href="mailto:legal@zoneploy.com" className="text-primary hover:underline">
                legal@zoneploy.com
              </a>.
            </Section>
          </div>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children, last = false }: {
  title: string
  children: React.ReactNode
  last?: boolean
}) {
  return (
    <section className={last ? '' : 'mb-8'}>
      <h2 className="text-lg font-semibold text-text-primary mb-3">{title}</h2>
      <div className="text-sm text-text-secondary leading-relaxed">{children}</div>
    </section>
  )
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc pl-5 space-y-1">
      {items.map((item, i) => <li key={i}>{item}</li>)}
    </ul>
  )
}
