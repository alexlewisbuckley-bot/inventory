import { describe, expect, it } from 'vitest'
import { materialFromReference } from '@/lib/rolex-reference'

const of = (reference: string) => materialFromReference('Rolex', reference)

/**
 * Every example here was given by the person who buys and sells these, which
 * is the only reason to trust a table like this at all.
 */
describe('the material digit of a Rolex reference', () => {
  it('0 is steel', () => {
    for (const r of ['116400', '116900', '216570']) expect(of(r), r).toBe('Oystersteel')
  })

  it('1 is steel and Everose', () => {
    for (const r of ['268621', '126711', '126201']) {
      expect(of(r), r).toBe('Two-tone Everose Rolesor')
    }
  })

  it('2 is steel and platinum', () => {
    for (const r of ['126622', '268622']) expect(of(r), r).toBe('Rolesium')
  })

  it('3 is steel and yellow gold', () => {
    for (const r of ['116503', '126603', '326933']) {
      expect(of(r), r).toBe('Two-tone Yellow Rolesor')
    }
  })

  it('4 is steel and white gold', () => {
    for (const r of ['115234', '326934', '279174']) {
      expect(of(r), r).toBe('Two-tone White Rolesor')
    }
  })

  it('5 is Everose', () => {
    for (const r of ['126715', '228235', '126655']) expect(of(r), r).toBe('18k Everose Gold')
  })

  it('6 is platinum', () => {
    for (const r of ['228206', '118206', '116506']) expect(of(r), r).toBe('950 Platinum')
  })

  it('7 is the 14k gold Rolex stopped using', () => {
    for (const r of ['1507', '15037']) expect(of(r), r).toBe('14k Yellow Gold')
  })

  it('8 is 18k yellow gold', () => {
    for (const r of ['116618', '118238', '116508']) expect(of(r), r).toBe('18k Yellow Gold')
  })

  it('9 is 18k white gold', () => {
    expect(of('228349')).toBe('18k White Gold')
  })

  it('reads past the suffix, which is a dial or a bezel', () => {
    // CHNR is a Root Beer bezel, BLRO a Pepsi, RBR a diamond bezel. None of
    // them says anything about the case.
    expect(of('126711CHNR')).toBe('Two-tone Everose Rolesor')
    expect(of('126719BLRO')).toBe('18k White Gold')
    expect(of('228349RBR')).toBe('18k White Gold')
    expect(of('126610LV')).toBe('Oystersteel')
  })

  it('reads a reference however it was typed', () => {
    expect(of('126711 chnr')).toBe('Two-tone Everose Rolesor')
    expect(of('126711-CHNR')).toBe('Two-tone Everose Rolesor')
  })

  it('does not read another house’s reference as a Rolex', () => {
    // Each of the three has its own scheme; a brand with none gets no answer.
    expect(materialFromReference('Hermès', 'Birkin 30')).toBeNull()
    expect(materialFromReference('Richard Mille', 'RM 011')).toBeNull()
    expect(materialFromReference('Cartier', 'WSSA0018')).toBeNull()
  })

  it('refuses anything too short to be a reference', () => {
    for (const r of ['', '11', '116', 'ABC']) expect(of(r), r).toBeNull()
  })
})

/**
 * Patek says it with a letter, in French: acier, or gris, or jaune, or rose,
 * platine, titane — which is why white gold is G and not W.
 */
describe('the material letter of a Patek reference', () => {
  const of = (reference: string) => materialFromReference('Patek Philippe', reference)

  it('reads the letter', () => {
    expect(of('5167A')).toBe('Stainless Steel')
    expect(of('6119G')).toBe('18k White Gold')
    expect(of('5396J')).toBe('18k Yellow Gold')
    expect(of('5204R')).toBe('18k Rose Gold')
    expect(of('5271P')).toBe('950 Platinum')
    expect(of('5961P')).toBe('950 Platinum')
  })

  it('ignores the dial code after the hyphen', () => {
    // "-010" is the dial, not the case.
    expect(of('5711/1A-010')).toBe('Stainless Steel')
    expect(of('5204R-001')).toBe('18k Rose Gold')
    expect(of('5740/1G-001')).toBe('18k White Gold')
  })

  it('reads past the digits inside the reference', () => {
    // In 5711/1A the material is the A, not the 1 beside it.
    expect(of('5711/1A')).toBe('Stainless Steel')
    expect(of('7118/1200A')).toBe('Stainless Steel')
  })

  it('reads it however it was typed', () => {
    expect(of('5961p')).toBe('950 Platinum')
  })

  it('says nothing for a reference carrying no letter', () => {
    expect(of('5711')).toBeNull()
    expect(of('')).toBeNull()
  })
})

/**
 * Audemars Piguet uses a pair of letters, straight after the model number.
 */
describe('the material pair of an Audemars Piguet reference', () => {
  const of = (reference: string) => materialFromReference('Audemars Piguet', reference)

  it('reads the pair', () => {
    expect(of('26331ST.OO.1220ST.02')).toBe('Stainless Steel')
    expect(of('15400ST')).toBe('Stainless Steel')
    expect(of('26331OR')).toBe('18k Rose Gold')
    expect(of('16204BA.OO.1240BA.01')).toBe('18k Yellow Gold')
    expect(of('26331BC')).toBe('18k White Gold')
    expect(of('26315PT')).toBe('950 Platinum')
    expect(of('25594TI')).toBe('Titanium')
    expect(of('26331SA')).toBe('Stainless Steel and Yellow Gold')
    expect(of('26331SN')).toBe('Stainless Steel and Rose Gold')
  })

  it('reads the case segment, not the bracelet or the dial', () => {
    // The later segments repeat a metal that is often not the case's.
    expect(of('26331ST.OO.1220ST.02')).toBe('Stainless Steel')
  })

  it('reads it however it was typed', () => {
    expect(of('26730st')).toBe('Stainless Steel')
  })

  it('says nothing for the combinations nobody has pinned down', () => {
    // IO and IP are titanium with ceramic or platinum, written down
    // inconsistently everywhere. At these prices a guess is worse than a gap.
    expect(of('26589IO')).toBeNull()
    expect(of('26631IO.OO.D002CA.01')).toBeNull()
    expect(of('26331IP')).toBeNull()
  })
})

/**
 * Vacheron files it the way Patek does — the same letters, in the same place.
 */
describe('the material letter of a Vacheron reference', () => {
  const of = (reference: string) => materialFromReference('Vacheron Constantin', reference)

  it('reads the letter after the strap code', () => {
    expect(of('4500V/110A-B128')).toBe('Stainless Steel')
    expect(of('81515/000R-9892')).toBe('18k Rose Gold')
    expect(of('47040/000G-9666')).toBe('18k White Gold')
    expect(of('5500V/000P-B046')).toBe('950 Platinum')
  })

  it('is not fooled by the collection letter at the front', () => {
    // The V in 4500V names the Overseas line, not the metal. The letter that
    // counts is the last one before the hyphen.
    expect(of('4500V/110A-B128')).toBe('Stainless Steel')
  })
})
