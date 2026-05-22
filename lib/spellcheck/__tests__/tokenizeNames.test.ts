import { tokenizeNames } from '../useDictionaryFeed'

describe('tokenizeNames', () => {
  it('splits on whitespace', () => {
    expect(tokenizeNames(['Aristarchus the Wise'])).toEqual(
      expect.arrayContaining(['Aristarchus', 'the', 'Wise']),
    )
  })

  it('splits on punctuation', () => {
    const tokens = tokenizeNames(["Marcus-Aurelius, O'Brien"])
    expect(tokens).toEqual(expect.arrayContaining(['Marcus', 'Aurelius', 'Brien']))
  })

  it('drops tokens shorter than 2 characters', () => {
    const tokens = tokenizeNames(['J K Rowling', 'a brief note'])
    expect(tokens).not.toContain('J')
    expect(tokens).not.toContain('K')
    expect(tokens).not.toContain('a')
    expect(tokens).toEqual(expect.arrayContaining(['Rowling', 'brief', 'note']))
  })

  it('drops pure-digit tokens', () => {
    const tokens = tokenizeNames(['Agent 47', '1984 Winston'])
    expect(tokens).not.toContain('47')
    expect(tokens).not.toContain('1984')
    expect(tokens).toEqual(expect.arrayContaining(['Agent', 'Winston']))
  })

  it('keeps tokens that are mixed alphanumeric', () => {
    const tokens = tokenizeNames(['R2D2 Droid'])
    expect(tokens).toEqual(expect.arrayContaining(['R2D2', 'Droid']))
  })

  it('deduplicates tokens across names', () => {
    const tokens = tokenizeNames(['Captain Smith', 'Mister Smith', 'Lady Smith'])
    const smithCount = tokens.filter((t) => t === 'Smith').length
    expect(smithCount).toBe(1)
  })

  it('ignores empty / falsy names', () => {
    const tokens = tokenizeNames(['', 'Real Name'])
    expect(tokens).toEqual(expect.arrayContaining(['Real', 'Name']))
  })

  it('caps the total set at 5000 and warns', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const tooMany = Array.from({ length: 6000 }, (_, i) => `Name${i}`)
    const tokens = tokenizeNames(tooMany)
    expect(tokens).toHaveLength(5000)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][0]).toContain('capped')
    warnSpy.mockRestore()
  })
})
