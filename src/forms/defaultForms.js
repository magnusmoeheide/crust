export const STENGESKJEMA_ID = 'stengeskjema'

export const defaultStengeskjema = {
  id: STENGESKJEMA_ID,
  slug: STENGESKJEMA_ID,
  title: 'Stengeskjema',
  description:
    'Fyll ut sjekklisten etter stenging. Legg gjerne ved bilder fra området som ble stengt.',
  updatedAt: null,
  questions: [
    {
      id: 'location',
      label: 'Lokasjon',
      type: 'text',
      required: true,
      placeholder: 'f.eks. Sognsvann',
    },
    {
      id: 'shiftDate',
      label: 'Dato',
      type: 'date',
      required: true,
    },
    {
      id: 'cleaningDone',
      label: 'Er området ryddet og rengjort?',
      type: 'select',
      required: true,
      options: ['Ja', 'Delvis', 'Nei'],
    },
    {
      id: 'inventoryStatus',
      label: 'Status på lager ved stenging',
      type: 'textarea',
      required: true,
      placeholder: 'Skriv kort status på deig, topping, drikke osv.',
    },
    {
      id: 'issues',
      label: 'Avvik eller hendelser',
      type: 'textarea',
      required: false,
      placeholder: 'Beskriv avvik, skader eller oppfølging som trengs.',
    },
  ],
}
