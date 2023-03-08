import compact from 'just-compact'
import {IntlIdStructure} from '@/constants'
import {createIntlFields} from './createIntlFields'
import {objectIsContentfulLink} from './objectIsContentfulLink'
import {findEditorControlForField} from './findEditorControlForField'
import {markdownToBlocks} from './markdownToBlocks'
import {toPortableText} from '@portabletext/contentful-rich-text-to-portable-text'
import {objectIsContentfulRichText} from './objectIsContentfulRichText'
import {generateKey} from './generateKey'
import {contentfulLinkToSanityReference} from './contentfulLinkToSanityReference'
import {objectIsContentfulLocation} from './objectIsContentfulLocation'
import type {SanityDocument} from '@sanity/client'
import type {ContentfulExport} from 'contentful-export'
import type {SysLink} from './objectIsContentfulLink'
import type {EntryProps} from 'contentful-management'

type ReferenceResolver = (
  node: {data: {target: SysLink}},
  opts: any,
) => ReturnType<typeof contentfulLinkToSanityReference> | null

type Options = {
  useMultiLocale: boolean
  idStructure: IntlIdStructure
  defaultLocale: string
  supportedLocales: string[]
  keepMarkdown?: boolean
  weakRefs?: boolean
}

export function contentfulEntryToSanityObject(
  entry: EntryProps<Record<string, Record<string, any>>>,
  locale: string,
  data: ContentfulExport,
  options: Options,
): SanityDocument {
  let doc: SanityDocument = {
    _id: entry.sys.id,
    _rev: entry.sys.id,
    _type: entry.sys.contentType.sys.id,
    _createdAt: entry.sys.createdAt,
    _updatedAt: entry.sys.updatedAt,
  }

  if (options.useMultiLocale) {
    doc = {
      ...doc,
      ...createIntlFields(doc._id, locale, {
        idStructure: options.idStructure,
        defaultLocale: options.defaultLocale,
        supportedLocales: options.supportedLocales,
      }),
    }
  }

  const fields = Object.entries<Record<string, any>>(entry.fields)
  for (const [key, values] of fields) {
    const control = findEditorControlForField(key, entry.sys.contentType.sys.id, data)
    const widgetId = control?.widgetId

    const value = values[locale]
    const canCopyValueAsIs = typeof value === 'string' || typeof value === 'number'
    if (canCopyValueAsIs) {
      if (widgetId === 'slugEditor') {
        doc[key] = {current: value}
      } else if (widgetId === 'markdown' && !options.keepMarkdown) {
        doc[key] = markdownToBlocks(String(value))
      } else {
        doc[key] = value
      }
    } else if (objectIsContentfulLink(value)) {
      doc[key] = contentfulLinkToSanityReference(value, locale, data, options)
    } else if (objectIsContentfulLocation(value)) {
      doc[key] = {
        _type: 'geopoint',
        lat: value.lat,
        lng: value.lon,
      }
    } else if (objectIsContentfulRichText(value)) {
      const referenceResolver: ReferenceResolver = (node) =>
        contentfulLinkToSanityReference(node.data.target, locale, data, options)

      doc[key] = toPortableText(value, {
        generateKey: () => generateKey(),
        referenceResolver,
        transformers: {
          hr: () => [
            {
              _type: 'break',
              _key: generateKey(),
              style: 'lineBreak',
            },
          ],
        },
      })
    } else if (Array.isArray(value)) {
      doc[key] = compact(
        value.map((val) => {
          if (objectIsContentfulLink(val)) {
            return contentfulLinkToSanityReference(val, locale, data, options)
          }

          return val
        }),
      )
    }
  }

  return doc
}
