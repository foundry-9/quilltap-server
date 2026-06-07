import { parseCarinaQuery } from '../carina-parser'

describe('parseCarinaQuery', () => {
  describe('basic syntax', () => {
    it('parses @Name: question format', () => {
      const result = parseCarinaQuery('@Alice: hello')
      expect(result).toEqual({
        characterName: 'Alice',
        whisper: false,
        question: 'hello',
      })
    })

    it('parses @Name? question format (whisper)', () => {
      const result = parseCarinaQuery('@Bob? are you there')
      expect(result).toEqual({
        characterName: 'Bob',
        whisper: true,
        question: 'are you there',
      })
    })

    it('sets whisper=false for colon separator', () => {
      const result = parseCarinaQuery('@Charlie: what time is it')
      expect(result?.whisper).toBe(false)
    })

    it('sets whisper=true for question-mark separator', () => {
      const result = parseCarinaQuery('@Diana? what time is it')
      expect(result?.whisper).toBe(true)
    })
  })

  describe('character names with spaces', () => {
    it('parses names with interior spaces', () => {
      const result = parseCarinaQuery('@Earl Grey: tea or coffee')
      expect(result?.characterName).toBe('Earl Grey')
      expect(result?.question).toBe('tea or coffee')
    })

    it('parses names with multiple interior spaces', () => {
      const result = parseCarinaQuery('@Lord Peter Wimsey? a question')
      expect(result?.characterName).toBe('Lord Peter Wimsey')
      expect(result?.whisper).toBe(true)
    })

    it('allows underscores at start and end of name', () => {
      // \w includes underscore, so @_Alice and @Alice_ both match
      const result = parseCarinaQuery('@_Alice: hi')
      expect(result?.characterName).toBe('_Alice')
    })

    it('requires at least two characters in the name', () => {
      // The regex [\w][\w ]*\w requires at least start-word and end-word
      // So single-char names like @A do not match
      const result = parseCarinaQuery('@A: hi')
      expect(result).toBe(null)
    })
  })

  describe('straight quotes (double)', () => {
    it('strips straight double quotes with matching close', () => {
      const result = parseCarinaQuery('@Bob: "What was the capital?"')
      expect(result?.question).toBe('What was the capital?')
    })

    it('preserves interior punctuation and spaces inside straight quotes', () => {
      const result = parseCarinaQuery('@Bob: "What was the capital? And who ruled?"')
      expect(result?.question).toBe('What was the capital? And who ruled?')
    })

    it('falls through to unquoted form when close quote is missing', () => {
      const result = parseCarinaQuery('@Bob: "no closing quote here')
      expect(result?.question).toBe('"no closing quote here')
    })

    it('returns empty string for quoted empty text', () => {
      const result = parseCarinaQuery('@Bob: ""')
      expect(result).toBe(null) // Empty question is skipped
    })
  })

  describe('straight quotes (single)', () => {
    it('strips straight single quotes with matching close', () => {
      const result = parseCarinaQuery("@Bob? 'two sentences here. yes?'")
      expect(result?.question).toBe('two sentences here. yes?')
    })

    it('falls through to unquoted form when close quote is missing', () => {
      const result = parseCarinaQuery("@Bob: 'no closing quote here")
      expect(result?.question).toBe("'no closing quote here")
    })
  })

  describe('smart quotes', () => {
    it('strips smart double quotes (curly braces)', () => {
      const result = parseCarinaQuery('@Bob: "fancy question"')
      expect(result?.question).toBe('fancy question')
    })

    it('strips smart single quotes (apostrophes)', () => {
      const result = parseCarinaQuery("@Bob: 'fancy question'")
      expect(result?.question).toBe('fancy question')
    })

    it('pairs smart open-quote with smart close-quote', () => {
      const result = parseCarinaQuery('@Bob: "what is this?"')
      expect(result?.question).toBe('what is this?')
    })

    it('pairs smart single-open with smart single-close', () => {
      const result = parseCarinaQuery("@Bob: 'what is this?'")
      expect(result?.question).toBe('what is this?')
    })

    it('falls through to unquoted when smart close quote is missing', () => {
      const result = parseCarinaQuery('@Bob: "no closing smart quote')
      expect(result?.question).toBe('"no closing smart quote')
    })
  })

  describe('unquoted questions', () => {
    it('extracts unquoted question to end of line', () => {
      const result = parseCarinaQuery('@Bob: everything after separator to end')
      expect(result?.question).toBe('everything after separator to end')
    })

    it('trims leading whitespace after separator', () => {
      const result = parseCarinaQuery('@Bob:    question with leading spaces')
      expect(result?.question).toBe('question with leading spaces')
    })

    it('trims trailing whitespace', () => {
      const result = parseCarinaQuery('@Bob: question with trailing spaces   ')
      expect(result?.question).toBe('question with trailing spaces')
    })
  })

  describe('multiple lines', () => {
    it('parses first @-line with non-empty question', () => {
      const content = '@Alice: first\n@Bob: second'
      const result = parseCarinaQuery(content)
      expect(result?.characterName).toBe('Alice')
      expect(result?.question).toBe('first')
    })

    it('skips first empty @-line and uses second with content', () => {
      const content = '@Alice:\n@Bob: real question'
      const result = parseCarinaQuery(content)
      expect(result?.characterName).toBe('Bob')
      expect(result?.question).toBe('real question')
    })

    it('ignores non-@ lines and continues scanning', () => {
      const content = 'some text\n@Charlie: the answer'
      const result = parseCarinaQuery(content)
      expect(result?.characterName).toBe('Charlie')
    })

    it('skips multiple empty @-lines', () => {
      const content = '@Alice:\n@Bob:\n@Charlie: found it'
      const result = parseCarinaQuery(content)
      expect(result?.characterName).toBe('Charlie')
      expect(result?.question).toBe('found it')
    })
  })

  describe('line endings', () => {
    it('handles Unix line endings (LF)', () => {
      const content = '@Alice: first\n@Bob: second'
      const result = parseCarinaQuery(content)
      expect(result?.characterName).toBe('Alice')
    })

    it('handles Windows line endings (CRLF)', () => {
      const content = '@Alice: first\r\n@Bob: second'
      const result = parseCarinaQuery(content)
      expect(result?.characterName).toBe('Alice')
    })

    it('strips trailing CR from question', () => {
      const content = '@Alice: question\r\nmore text'
      const result = parseCarinaQuery(content)
      expect(result?.question).toBe('question')
    })

    it('handles mixed line endings', () => {
      const content = '@Alice: first\n@Bob: second\r\n@Charlie: third'
      const result = parseCarinaQuery(content)
      expect(result?.characterName).toBe('Alice')
    })
  })

  describe('@-detection rules', () => {
    it('requires @ at the beginning of the line', () => {
      const content = 'email me@host: what is this'
      expect(parseCarinaQuery(content)).toBe(null)
    })

    it('does not match @ in the middle of a line', () => {
      const content = 'some text @Alice: question'
      expect(parseCarinaQuery(content)).toBe(null)
    })

    it('matches @ only when it starts a line (after newline)', () => {
      const content = 'first line\n@Alice: question'
      expect(parseCarinaQuery(content)).toEqual({
        characterName: 'Alice',
        whisper: false,
        question: 'question',
      })
    })
  })

  describe('empty and null input', () => {
    it('returns null for null input', () => {
      expect(parseCarinaQuery(null as any)).toBe(null)
    })

    it('returns null for empty string', () => {
      expect(parseCarinaQuery('')).toBe(null)
    })

    it('returns null for whitespace-only string', () => {
      expect(parseCarinaQuery('   \n  \n  ')).toBe(null)
    })

    it('returns null when no @-line is present', () => {
      const content = 'just some regular text\nwith no carina queries'
      expect(parseCarinaQuery(content)).toBe(null)
    })
  })

  describe('empty question text', () => {
    it('returns null when question is empty after colon', () => {
      expect(parseCarinaQuery('@Alice:')).toBe(null)
    })

    it('returns null when question is only whitespace', () => {
      expect(parseCarinaQuery('@Alice:    ')).toBe(null)
    })

    it('returns null when quoted question is empty', () => {
      expect(parseCarinaQuery('@Alice: ""')).toBe(null)
    })

    it('continues scanning when first @-line has empty question', () => {
      const content = '@Alice:\n@Bob: has content'
      const result = parseCarinaQuery(content)
      expect(result?.characterName).toBe('Bob')
    })
  })

  describe('edge cases with quotes', () => {
    it('treats opening quote in question as part of unquoted text when no close', () => {
      const result = parseCarinaQuery('@Bob: "incomplete')
      expect(result?.question).toBe('"incomplete')
    })

    it('does not span quotes across lines (quoted form is per-line)', () => {
      const content = '@Bob: "first line\nmore text"'
      const result = parseCarinaQuery(content)
      // The first line is @Bob: "first line
      // The quote opens but never closes on that line, so it falls through to unquoted
      expect(result?.question).toBe('"first line')
    })

    it('extracts content between matching smart quotes correctly', () => {
      const result = parseCarinaQuery('@Bob: "hello world"')
      expect(result?.question).toBe('hello world')
    })

    it('prioritizes smart close-quote when open is smart', () => {
      // " should close with ", not match a straight "
      const result = parseCarinaQuery('@Bob: "text" more')
      expect(result?.question).toBe('text')
    })
  })

  describe('whitespace handling', () => {
    it('trims leading/trailing whitespace in extracted question', () => {
      const result = parseCarinaQuery('@Bob:   question text   ')
      expect(result?.question).toBe('question text')
    })

    it('preserves interior whitespace in question', () => {
      const result = parseCarinaQuery('@Bob: what   is   this')
      expect(result?.question).toBe('what   is   this')
    })

    it('trims whitespace inside quoted questions', () => {
      const result = parseCarinaQuery('@Bob: "  text inside  "')
      expect(result?.question).toBe('text inside')
    })

    it('handles tabs as whitespace', () => {
      const result = parseCarinaQuery('@Bob:\t\tquestion')
      expect(result?.question).toBe('question')
    })
  })

  describe('character name edge cases', () => {
    it('does not allow single-letter names', () => {
      const result = parseCarinaQuery('@A: hi')
      expect(result).toBe(null)
    })

    it('allows names with numbers', () => {
      const result = parseCarinaQuery('@Bot2: hello')
      expect(result?.characterName).toBe('Bot2')
    })

    it('allows names with underscores in the middle', () => {
      const result = parseCarinaQuery('@Alice_Bob: hi')
      expect(result?.characterName).toBe('Alice_Bob')
    })

    it('requires separator immediately after name (no space before separator)', () => {
      const result = parseCarinaQuery('@Alice : question')
      // The regex requires the separator immediately after the name, no space before it
      expect(result).toBe(null)
    })

    it('handles name with digits and spaces', () => {
      const result = parseCarinaQuery('@Bot 2 Version 3: question')
      expect(result?.characterName).toBe('Bot 2 Version 3')
    })
  })

  describe('real-world examples', () => {
    it('parses a typical public query', () => {
      const result = parseCarinaQuery('@Jeeves: What is the capital of Wessex?')
      expect(result).toEqual({
        characterName: 'Jeeves',
        whisper: false,
        question: 'What is the capital of Wessex?',
      })
    })

    it('parses a typical whispered query', () => {
      const result = parseCarinaQuery('@PeterWimsey? Is this a coded message?')
      expect(result?.whisper).toBe(true)
      expect(result?.question).toBe('Is this a coded message?')
    })

    it('parses quoted question with interior punctuation', () => {
      const result = parseCarinaQuery(
        '@Alice: "Do you know the answer? What about alternatives? Which is best?"'
      )
      expect(result?.question).toBe('Do you know the answer? What about alternatives? Which is best?')
    })

    it('ignores text before the @-line', () => {
      const content = 'I have a question for someone.\n@Bob: What is this?'
      const result = parseCarinaQuery(content)
      expect(result?.characterName).toBe('Bob')
    })

    it('ignores text after the matched @-line', () => {
      const content = '@Bob: What?\n\nSome follow-up text that is ignored.'
      const result = parseCarinaQuery(content)
      expect(result?.question).toBe('What?')
    })
  })

  describe('quote pairing specificity', () => {
    it('straight double quote closes with straight double quote', () => {
      const result = parseCarinaQuery('@Bob: "question"')
      expect(result?.question).toBe('question')
    })

    it('straight single quote closes with straight single quote', () => {
      const result = parseCarinaQuery("@Bob: 'question'")
      expect(result?.question).toBe('question')
    })

    it('smart open-double closes with smart close-double', () => {
      const result = parseCarinaQuery('@Bob: "question"')
      expect(result?.question).toBe('question')
    })

    it('smart open-single closes with smart close-single', () => {
      const result = parseCarinaQuery("@Bob: 'question'")
      expect(result?.question).toBe('question')
    })

    it('matches open smart-quote with close smart-quote', () => {
      // The open smart quote " matches close smart quote "
      // This test uses actual smart quote characters in the string literal
      const result = parseCarinaQuery('@Bob: "text"')
      expect(result?.question).toBe('text')
    })
  })
})
