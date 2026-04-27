import { useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'

interface OtpInputProps {
  length?: number
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
}

export function OtpInput({ length = 6, value, onChange, disabled, className }: OtpInputProps) {
  const inputsRef = useRef<Array<HTMLInputElement | null>>([])

  const digits = Array.from({ length }, (_, i) => value[i] ?? '')

  const focus = (index: number) => {
    inputsRef.current[index]?.focus()
  }

  const handleChange = useCallback((index: number, char: string) => {
    const digit = char.replace(/\D/g, '').slice(-1)
    const next = value.split('')
    next[index] = digit
    // fill gaps with empty
    for (let i = 0; i < length; i++) if (!next[i]) next[i] = ''
    const newVal = next.slice(0, length).join('')
    onChange(newVal)
    if (digit && index < length - 1) focus(index + 1)
  }, [value, length, onChange])

  const handleKeyDown = useCallback((index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault()
      if (value[index]) {
        const next = value.split('')
        next[index] = ''
        onChange(next.join(''))
      } else if (index > 0) {
        const next = value.split('')
        next[index - 1] = ''
        onChange(next.join(''))
        focus(index - 1)
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault()
      focus(index - 1)
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      e.preventDefault()
      focus(index + 1)
    }
  }, [value, length, onChange])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length)
    if (!pasted) return
    const next = pasted.split('').concat(Array(length).fill('')).slice(0, length)
    onChange(next.join(''))
    focus(Math.min(pasted.length, length - 1))
  }, [length, onChange])

  return (
    <div className={cn('w-full flex items-center gap-2', className)}>
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={el => { inputsRef.current[i] = el }}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          value={digit}
          disabled={disabled}
          onChange={e => handleChange(i, e.target.value)}
          onKeyDown={e => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={e => e.target.select()}
          className={cn(
            'flex-1 min-w-0 aspect-square rounded-xl border-2 border-grey-200 bg-background-paper',
            'text-center text-xl font-bold text-text-primary',
            'outline-none transition-all caret-transparent',
            'focus:border-primary focus:shadow-[0_0_0_4px] focus:shadow-primary/15',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            digit && 'border-primary/50',
          )}
        />
      ))}
    </div>
  )
}
