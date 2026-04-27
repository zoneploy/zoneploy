import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Logo } from '@/components/Logo'
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher'

export function PrivacyPage() {
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
            <h1 className="text-2xl font-bold text-text-primary mb-1">{t('legal.privacy.title')}</h1>
            <p className="text-sm text-text-secondary mb-8">{t('legal.privacy.updated')}</p>

            <Section title={t('legal.privacy.s1_title')}>
              {t('legal.privacy.s1_body')}
            </Section>

            <Section title={t('legal.privacy.s2_title')}>
              <p className="mb-2">{t('legal.privacy.s2_intro')}</p>
              <BulletList items={t('legal.privacy.s2_items', { returnObjects: true }) as string[]} />
            </Section>

            <Section title={t('legal.privacy.s3_title')}>
              <p className="mb-2">{t('legal.privacy.s3_intro')}</p>
              <BulletList items={t('legal.privacy.s3_items', { returnObjects: true }) as string[]} />
            </Section>

            <Section title={t('legal.privacy.s4_title')}>
              {t('legal.privacy.s4_body')}
            </Section>

            <Section title={t('legal.privacy.s5_title')}>
              {t('legal.privacy.s5_body')}
            </Section>

            <Section title={t('legal.privacy.s6_title')}>
              {t('legal.privacy.s6_body')}
            </Section>

            <Section title={t('legal.privacy.s7_title')}>
              {t('legal.privacy.s7_body')}
            </Section>

            <Section title={t('legal.privacy.s8_title')}>
              {t('legal.privacy.s8_body')}
            </Section>

            <Section title={t('legal.privacy.s9_title')}>
              {t('legal.privacy.s9_body')}
            </Section>

            <Section title={t('legal.privacy.s10_title')}>
              {t('legal.privacy.s10_body')}
            </Section>

            <Section title={t('legal.privacy.s11_title')}>
              <p className="mb-2">{t('legal.privacy.s11_intro')}</p>
              <BulletList items={t('legal.privacy.s11_items', { returnObjects: true }) as string[]} />
              <p className="mt-3">
                {t('legal.privacy.s11_contact')}{' '}
                <a href="mailto:privacy@zoneploy.com" className="text-primary hover:underline">
                  privacy@zoneploy.com
                </a>.
              </p>
            </Section>

            <Section title={t('legal.privacy.s12_title')} last>
              {t('legal.privacy.s12_body')}{' '}
              <a href="mailto:privacy@zoneploy.com" className="text-primary hover:underline">
                privacy@zoneploy.com
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
