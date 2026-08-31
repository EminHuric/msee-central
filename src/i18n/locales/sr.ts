/**
 * Serbian (Latin) message catalogue.
 *
 * Mirrors the shape of en.ts exactly. Plural entries use four slots
 * (none | one | few | many) resolved by the Serbian rule in ../index.ts.
 */

export default {
  app: {
    name: 'MsEe Central',
    tagline: 'Interna platforma kompanije',
  },

  common: {
    save: 'Sačuvaj',
    saving: 'Čuvanje…',
    cancel: 'Otkaži',
    close: 'Zatvori',
    confirm: 'Potvrdi',
    delete: 'Obriši',
    edit: 'Izmeni',
    create: 'Napravi',
    search: 'Pretraga',
    filter: 'Filter',
    clear: 'Poništi',
    back: 'Nazad',
    next: 'Dalje',
    submit: 'Pošalji',
    submitting: 'Slanje…',
    loading: 'Učitavanje…',
    retry: 'Pokušaj ponovo',
    view: 'Pogledaj',
    viewProfile: 'Pogledaj profil',
    all: 'Sve',
    none: 'Ništa',
    yes: 'Da',
    no: 'Ne',
    optional: 'opciono',
    required: 'obavezno',
    notSet: 'Nije uneto',
    hidden: 'Skriveno',
    hiddenByPrivacy: 'Skriveno podešavanjima privatnosti',
    unknown: 'Nepoznato',
    actions: 'Radnje',
    results: 'Nema rezultata | {n} rezultat | {n} rezultata | {n} rezultata',
    selectPlaceholder: 'Izaberi…',
    searchPlaceholder: 'Pretraži…',
    copy: 'Kopiraj',
    copied: 'Kopirano',
    export: 'Izvezi',
    refresh: 'Osveži',
  },

  auth: {
    signIn: 'Prijava',
    signInTitle: 'Prijava na MsEe Central',
    signInSubtitle: 'Pristup samo za zaposlene.',
    register: 'Zatraži pristup',
    registerTitle: 'Zahtev za pristup MsEe Central-u',
    registerSubtitle:
      'Popuni svoje podatke. CEO pregleda svaki zahtev pre nego što se nalog aktivira.',
    email: 'Email',
    password: 'Lozinka',
    confirmPassword: 'Potvrdi lozinku',
    forgotPassword: 'Zaboravljena lozinka?',
    noAccount: 'Još nemaš nalog?',
    haveAccount: 'Već imaš nalog?',
    signingIn: 'Prijavljivanje…',
    invalidCredentials: 'Pogrešan email ili lozinka.',
    tooManyAttempts: 'Previše neuspelih pokušaja. Pokušaj kasnije.',
    resetSent: 'Ako ta adresa pripada nalogu, poslat je link za promenu lozinke.',
    pendingTitle: 'Čeka se odobrenje',
    pendingMessage:
      'Vaš zahtev za registraciju je poslat. CEO će pregledati vaš nalog i odobriti pristup.',
    pendingHint: 'Moći ćeš da se prijaviš čim tvoj nalog bude odobren.',
    blockedTitle: 'Pristup nije moguć',
    suspendedMessage: 'Tvoj nalog je suspendovan. Obrati se CEO-u za više informacija.',
    deactivatedMessage: 'Tvoj nalog je deaktiviran.',
    rejectedMessage: 'Tvoj zahtev za registraciju nije odobren.',
    rejectionReason: 'Navedeni razlog',
  },

  register: {
    sectionAccount: 'Nalog',
    sectionPersonal: 'Lični podaci',
    sectionProfessional: 'Poslovni podaci',
    firstName: 'Ime',
    lastName: 'Prezime',
    phone: 'Broj telefona',
    country: 'Država',
    city: 'Grad',
    photo: 'Profilna slika',
    photoHint: 'JPG, PNG ili WebP. Smanjuje se na 256px pre čuvanja.',
    photoChoose: 'Izaberi sliku',
    photoChange: 'Promeni sliku',
    photoRemove: 'Ukloni',
    photoProcessing: 'Obrada…',
    personalDescription: 'Kratak lični opis',
    personalDescriptionHint: 'Nekoliko rečenica o tebi.',
    desiredPosition: 'Željena pozicija',
    desiredPositionHint: 'Radno mesto za koje se prijavljuješ.',
    additionalInfo: 'Dodatne informacije',
    additionalInfoHint: 'Sve ostalo što bi CEO trebalo da zna.',
    passwordHint: 'Najmanje {min} karaktera.',
    terms: 'Uslovi internog sistema',
    termsText:
      'Potvrđujem da su navedeni podaci tačni i prihvatam da je MsEe Central interni sistem kompanije čije se korišćenje beleži.',
    submit: 'Pošalji zahtev',
    emailInUse: 'Nalog sa tom email adresom već postoji.',
    weakPassword: 'Ta lozinka je preslaba. Koristi najmanje {min} karaktera.',
  },

  profile: {
    title: 'Moj profil',
    subtitle: 'Šta vide tvoje kolege, a šta ostaje samo kod tebe.',
    completeness: 'Popunjenost profila',
    complete: 'Tvoj profil je kompletan.',
    missingOne: 'Još jedno obavezno polje je prazno.',
    missingMany: 'Još {n} obaveznih polja je prazno.',
    requiredMark: 'Obavezno',

    sectionIdentity: 'Identitet',
    sectionAbout: 'O tebi',
    sectionPersonal: 'Lični podaci',
    sectionWork: 'Radni podaci',
    sectionPrivacy: 'Privatnost',

    visibleToAll: 'Vidi svaki kolega',
    visibleToAllHint: 'Poslovni podaci. Opisuju posao, pa se ne mogu sakriti.',
    youControl: 'Ti biraš ko ovo vidi',
    youControlHint: 'Popuni ih — pa ispod izaberi kome se prikazuju.',

    bio: 'Poslovni opis',
    bioHint: 'Nekoliko redova o tome šta radiš ovde.',
    skills: 'Veštine',
    skillsHint: 'Pritisni Enter posle svake.',
    expertise: 'Oblasti ekspertize',
    languages: 'Jezici',
    interests: 'Profesionalna interesovanja',

    position: 'Pozicija',
    department: 'Sektor',
    role: 'Uloga',
    startDate: 'Datum početka',
    dateJoined: 'Učlanjen',
    employmentStatus: 'Vrsta angažmana',
    manager: 'Nadređeni',
    employeeCode: 'Broj zaposlenog',
    responsibilities: 'Odgovornosti',

    managedByCeo: 'Postavlja CEO',
    manageYourOwnHint: 'Imaš dozvolu da ovo sam postaviš.',
    managedByCeoHint:
      'Tvoju ulogu, poziciju, sektor i status naloga određuje CEO i ne mogu se menjati ovde.',

    photoRequired: 'Profilna slika je obavezna.',
    saved: 'Profil je sačuvan.',
    saveFailed: 'Profil nije mogao da se sačuva.',

    tagAdd: 'Dodaj',
    tagPlaceholder: 'Ukucaj pa pritisni Enter',
    tagRemove: 'Ukloni {item}',
    emptyList: 'Još ništa nije dodato.',
  },

  employees: {
    title: 'Zaposleni',
    subtitle: 'Svi u MsEe.',
    searchPlaceholder: 'Pretraga po imenu, poziciji ili veštini',
    filterStatus: 'Status',
    filterDepartment: 'Sektor',
    allStatuses: 'Svi statusi',
    allDepartments: 'Svi sektori',
    empty: 'Nema zaposlenih koji odgovaraju',
    emptyHint: 'Probaj drugi pojam ili poništi filtere.',
    emptyAll: 'Još nema zaposlenih',
    emptyAllHint: 'Odobreni zahtevi za registraciju pojavljuju se ovde.',
    noPosition: 'Pozicija nije postavljena',
    contact: 'Kontakt',
    about: 'O zaposlenom',
    work: 'Posao',
    skills: 'Veštine',
    hiddenNotice: 'Neki podaci su skriveni podešavanjima privatnosti te osobe.',
    backToList: 'Nazad na zaposlene',
    joined: 'Učlanjen {date}',
    you: 'Ti',
  },

  manage: {
    title: 'Upravljanje zaposlenim',
    open: 'Upravljaj',
    workInfo: 'Radni podaci',
    account: 'Nalog i pristup',
    position: 'Pozicija',
    department: 'Sektor',
    employmentStatus: 'Vrsta angažmana',
    startDate: 'Datum početka',
    manager: 'Nadređeni',
    responsibilities: 'Odgovornosti',
    roles: 'Uloge',
    accountStatus: 'Status naloga',
    noneSelected: 'Nema',
    noPositions: 'Nijedna pozicija još nije definisana.',
    noDepartments: 'Nijedan sektor još nije definisan.',
    createInSettings: 'Napravi ih u Podešavanjima.',
    saved: 'Izmene su sačuvane.',
    saveFailed: 'Izmene nisu mogle da se sačuvaju.',
    founderProtected:
      'Ovo je nalog vlasnika kompanije. Niko ne može da ga menja, ni drugi suvlasnici. To je ono što čini nemogućim da ga neko skloni iz sopstvene firme.',
    founderOnly:
      'Samo vlasnik može da postavi ili skine suvlasnika. Suvlasnici imaju punu nadležnost nad svim ostalim, ali ne mogu sami da šire krug vlasnika.',
    deletePermanently: 'Obriši trajno',
    deleteTitle: 'Obrisati ovu osobu i sve njene podatke?',
    deleteText:
      'Ovo se ne može poništiti. Brišu se profil, kontakt podaci i CEO beleške. Ako samo hoćeš da mu oduzmeš pristup, koristi deaktiviranje — ono čuva zapis i može da se vrati.',
    deleteConfirmLabel: 'Ukucaj {name} za potvrdu',
    deleteDone: '{name} je obrisan.',
    deleteFailed: 'Osoba nije mogla da se obriše.',
    deleteLoginNote:
      'Njegova prijava još postoji ali više ne vodi nigde. Pokreni npm run purge-logins da je ukloniš.',
    reversible: 'Može da se poništi — vratićeš ga kad hoćeš',
    irreversible: 'Trajno — nema povratka',
    profileSection: 'Profil',
    profileHint: 'Slika, ime i opis. Menjanje ovoga kod drugog je za ispravke — svako održava svoj.',
    contactSection: 'Kontakt podaci',
    contactHint: 'Šta koje polje pokazuje kolegama bira sama osoba. Izmena vrednosti ovde ne menja ko je vidi.',
    profileSaved: 'Profil je sačuvan.',
    founderBadge: 'Vlasnik',
    selfDemotion:
      'Ne možeš sam sebi da skineš CEO ulogu. Prvo postavi drugog CEO-a, pa on može da menja tvoju — tako firma nikad ne može da ostane bez ikoga ko njome upravlja.',
    selfCeoNotice:
      'Kao CEO možeš da menjaš sopstvene uloge. Dve stvari ostaju zaključane: ne možeš sam sebi da skineš CEO ulogu ni da suspenduješ svoj nalog, pa ne možeš sam sebe da zaključaš napolje.',
    selfNotice:
      'Ne možeš menjati sopstvenu ulogu ni status naloga. Niko ne sme da menja svoje dozvole — to je pravilo koje sprečava zaposlenog da sam sebe unapredi, i važi i za CEO-a.',
    rolePermissionCount: '{n} dozvola',
    confirmSuspendTitle: 'Suspendovati ovaj nalog?',
    confirmSuspendText:
      'Biće odjavljen i ne može da koristi MsEe Central dok ga ne aktiviraš. Zapis se čuva.',
    confirmDeactivateTitle: 'Deaktivirati ovaj nalog?',
    confirmDeactivateText:
      'Koristi ovo kad neko napusti kompaniju. Zapis i istorija se čuvaju.',
    confirmActivateTitle: 'Ponovo aktivirati nalog?',
    confirmActivateText: 'Vratiće mu se pristup sa postojećom ulogom.',
  },

  organisation: {
    title: 'Organizacija',
    departments: 'Sektori',
    positions: 'Pozicije',
    addDepartment: 'Dodaj sektor',
    addPosition: 'Dodaj poziciju',
    editDepartment: 'Izmeni sektor',
    editPosition: 'Izmeni poziciju',
    nameEn: 'Naziv (engleski)',
    nameSr: 'Naziv (srpski)',
    titleEn: 'Naziv (engleski)',
    titleSr: 'Naziv (srpski)',
    description: 'Opis',
    parentDepartment: 'Sektor',
    statusActive: 'Aktivan',
    statusInactive: 'Neaktivan',
    emptyDepartments: 'Još nema sektora',
    emptyDepartmentsHint: 'Sektori grupišu zaposlene i prikazuju se na svakom profilu.',
    emptyPositions: 'Još nema pozicija',
    emptyPositionsHint: 'Pozicija je posao koji neko radi. Odvojena je od uloge.',
    saved: 'Sačuvano.',
    saveFailed: 'Nije moglo da se sačuva.',
    inUse: 'Koristi {n}',
    positionVsRole:
      'Pozicija je posao (Marketing Manager). Uloga je šta neko sme unutar ovog sistema (Manager). Namerno su odvojene.',
  },

  tabs: {
    employees: 'Zaposleni',
    pending: 'Na čekanju',
    suspended: 'Suspendovani',
    rejected: 'Odbijeni',
  },

  table: {
    name: 'Ime',
    role: 'Uloga',
    position: 'Pozicija',
    department: 'Sektor',
    status: 'Status',
    joined: 'Učlanjen',
    submitted: 'Poslato',
    requestedPosition: 'Tražena pozicija',
    location: 'Lokacija',
    reviewedBy: 'Odlučio',
    reason: 'Razlog',
  },

  approval: {
    review: 'Pregledaj',
    approve: 'Odobri',
    reject: 'Odbij',
    approveTitle: 'Odobriti ovog zaposlenog?',
    approveText: 'Moći će odmah da se prijavi sa ulogom koju mu dodeliš ispod.',
    rejectTitle: 'Odbiti ovaj zahtev?',
    rejectText: 'Neće dobiti pristup. Zahtev se čuva, zajedno sa tvojim razlogom.',
    reason: 'Razlog odbijanja',
    reasonOptional: 'Opciono. Prikazuje se podnosiocu.',
    assignRole: 'Uloga',
    assignPosition: 'Pozicija',
    assignDepartment: 'Sektor',
    assignEmployment: 'Vrsta angažmana',
    assignStartDate: 'Datum početka',
    beforeApproving: 'Postavi pre odobravanja',
    noRoleWarning: 'Dodeli bar jednu ulogu, inače će se prijaviti bez ikakvog pristupa.',
    approved: 'Zaposleni je odobren.',
    rejected: 'Zahtev je odbijen.',
    failed: 'Odluka nije mogla da se sačuva.',
    emptyPending: 'Nema zahteva na čekanju',
    emptyPendingHint: 'Novi zahtevi za registraciju pojavljuju se ovde na tvoju odluku.',
    emptyRejected: 'Nema odbijenih zahteva',
    emptyRejectedHint: 'Zahtevi koje odbiješ čuvaju se ovde.',
    emptySuspended: 'Niko nije suspendovan',
    emptySuspendedHint: 'Suspendovani i deaktivirani nalozi su ovde. Zapisi se nikad ne brišu.',
    contactDetails: 'Kontakt',
    aboutApplicant: 'O kandidatu',
  },

  coAdmin: {
    warningTitle: 'Ovo daje punu kontrolu',
    warningText:
      'Drugi CEO može da upravlja svim zaposlenima, čita svaku privatnu belešku i menja tvoju ulogu i status. Daj to samo nekome kome bi poverio firmu.',
    whyNotSelf:
      'Ne možeš sam sebi da menjaš ulogu ni status. Postavi drugog administratora i on to može umesto tebe — to je ono što sprečava da jedan provaljen nalog preuzme sve.',
  },

  newEmployee: {
    open: 'Dodaj zaposlenog',
    title: 'Napravi nalog zaposlenom',
    subtitle:
      'Sam praveš nalog, pa niko ne mora da se registruje i čeka. Može da se prijavi čim završiš.',
    tempPassword: 'Privremena lozinka',
    generate: 'Generiši',
    passwordHint: 'Predaj mu je lično. Treba da je promeni posle prve prijave.',
    sendReset: 'Pošalji mu email da sam postavi lozinku',
    sendResetHint: 'Preporučeno. Tada uopšte ne držiš tuđu lozinku u rukama.',
    create: 'Napravi nalog',
    creating: 'Pravljenje…',
    created: 'Nalog je napravljen za {name}.',
    exists: 'Nalog sa tom email adresom već postoji.',
    failed: 'Nalog nije mogao da se napravi.',
    noRole: 'Izaberi bar jednu ulogu, inače će se prijaviti bez pristupa.',
    credentialsTitle: 'Nalog je spreman',
    credentialsText: 'Predaj ovo odmah — lozinka se nigde ne čuva i neće biti ponovo prikazana.',
    copied: 'Kopirano.',
  },

  roles: {
    title: 'Uloge i dozvole',
    subtitle: 'Ti odlučuješ šta koja uloga sme. Napravi koliko god ih firmi treba.',
    newRole: 'Nova uloga',
    editRole: 'Izmeni ulogu',
    name: 'Naziv uloge',
    nameHint: 'Kako se uloga zove, na primer Marketing Manager.',
    description: 'Opis',
    descriptionHint: 'Čemu uloga služi. Opciono, ali ćeš sebi kasnije biti zahvalan.',
    permissions: 'Šta ova uloga sme',
    permissionsHint: 'Označi samo ono što ulozi stvarno treba. Sve ostalo ostaje zatvoreno.',
    selectedCount: 'ništa nije izabrano | izabrana {n} | izabrane {n} | izabrano {n}',
    selectGroup: 'Sve',
    clearGroup: 'Ništa',
    peopleCount: 'niko | {n} osoba | {n} osobe | {n} osoba',
    ownerRole: 'Vlasnik',
    ownerRoleHint:
      'Vlasničke uloge imaju sve dozvole, sadašnje i buduće, i ne mogu se menjati ovde. Samo vlasnik firme sme da ih dodeli.',
    lockedRole: 'Zaključana',
    empty: 'Još nema uloga',
    emptyHint: 'Napravi ulogu, označi šta sme, pa je dodeli ljudima.',
    saved: 'Uloga je sačuvana.',
    saveFailed: 'Uloga nije mogla da se sačuva.',
    nameRequired: 'Daj ulozi naziv.',
    noPermissions: 'Ova uloga ne sme ništa. Ko je dobije prijaviće se u praznu aplikaciju.',
    sensitive: 'Osetljivo',
    sensitiveHint:
      'Ove dozvole daju uvid u privatne podatke ili širenje sopstvenih ovlašćenja. Deli ih štedljivo.',
    inUseWarning: 'Dodeljena: {n}. Izmene važe odmah.',
    statusActive: 'Aktivna',
    statusInactive: 'Neaktivna',
    statusHint: 'Neaktivna uloga ne može da se dodeli, ali je zadržavaju oni koji je već imaju.',
  },

  accountType: {
    label: 'Tip naloga',
    employee: 'Zaposleni',
    affiliate: 'Affiliate partner',
    employeeHint: 'Zaposlen u firmi. Šta vidi zavisi od uloge koju mu daš.',
    affiliateHint:
      'Spoljni saradnik koji dovodi posao i zarađuje proviziju. Vidi samo svoje brojke — nikad kolege, podatke firme ni interne spiskove.',
    filterAll: 'Svi',
    isolationNotice:
      'Affiliate naloge izoluju sigurnosna pravila, ne njihova uloga. I da ima sve dozvole, i dalje vidi samo svoj zapis.',
  },

  settings: {
    personal: 'Tvoja podešavanja',
    languageHint: 'Važi samo za tebe. Kolege zadržavaju svoj izbor.',
    themeHint: 'Važi samo za tebe, na ovom uređaju.',
  },

  dashboard: {
    greeting: 'Zdravo, {name}',
    subtitleOwner: 'Kako firma stoji danas.',
    subtitleEmployee: 'Tvoj deo MsEe Central-a.',
    subtitleAffiliate: 'Tvoja prodaja i provizija.',

    totalEmployees: 'Zaposleni',
    activeEmployees: 'Aktivni',
    pendingRequests: 'Čeka tebe',
    suspended: 'Suspendovani',
    affiliates: 'Affiliate partneri',

    pendingTitle: 'Zahtevi za registraciju',
    pendingNone: 'Ništa ne čeka.',
    pendingSome: 'niko ne čeka | {n} osoba čeka tvoju odluku | {n} osobe čekaju tvoju odluku | {n} osoba čeka tvoju odluku',
    review: 'Pregledaj ih',

    recentActivity: 'Nedavne radnje',
    activityNone: 'Još ništa nije zabeleženo.',
    seeAll: 'Vidi sve',

    recentlyJoined: 'Nedavno pridruženi',

    yourProfile: 'Tvoj profil',
    profileIncomplete: 'Tvoj profil je {percent}% popunjen.',
    profileComplete: 'Tvoj profil je kompletan.',
    completeProfile: 'Dovrši ga',

    comingSoon: 'Uskoro',
    earningsSoon:
      'Tvoja zarada, bonusi i zadaci pojaviće se ovde kad ti delovi sistema budu napravljeni.',
    commissionSoon:
      'Tvoja prodaja, provizija i isplate pojaviće se ovde kad taj deo sistema bude napravljen.',
  },

  auditAction: {
    'registration.submitted': 'Poslat zahtev za registraciju',
    'account.approved': 'Nalog odobren',
    'account.rejected': 'Zahtev odbijen',
    'account.suspended': 'Nalog suspendovan',
    'account.activated': 'Nalog aktiviran',
    'account.deactivated': 'Nalog deaktiviran',
    'role.created': 'Uloga napravljena',
    'role.updated': 'Uloga izmenjena',
    'role.deactivated': 'Uloga povučena',
    'role.assigned': 'Uloge dodeljene',
    'permissions.changed': 'Dozvole izmenjene',
    'position.changed': 'Radni podaci izmenjeni',
    'department.changed': 'Sektor izmenjen',
    'profile.updated': 'Profil izmenjen',
    'privacy.changed': 'Privatnost izmenjena',
    'note.created': 'Beleška napisana',
    'note.updated': 'Beleška izmenjena',
    'note.deleted': 'Beleška obrisana',
    'auth.login': 'Prijava',
    'auth.login_failed': 'Neuspela prijava',
    'settings.updated': 'Podešavanja izmenjena',
    'data.exported': 'Podaci izvezeni',
  },

  nav2: {
    sectionCompany: 'Kompanija',
    sectionBusiness: 'Poslovanje',
    sectionPeople: 'Ljudi',
    sectionAdmin: 'Administracija',
    sectionWorkspace: 'Moj prostor',

    clients: 'Klijenti',
    leads: 'Potencijalni klijenti',
    goals: 'Ciljevi i KPI',
    performance: 'Učinak',
    organization: 'Organizacija',
    tasks: 'Moji zadaci',
    earnings: 'Moja zarada',

    soon: 'Uskoro',
    soonTitle: 'Još nije napravljeno',
  },

  search: {
    placeholder: 'Pretraži ljude, uloge, stranice',
    open: 'Pretraga',
    shortcut: 'Ctrl K',
    noResults: 'Ništa nije nađeno za {term}',
    people: 'Ljudi',
    pages: 'Stranice',
    hint: 'Ukucaj ime, poziciju ili stranicu.',
  },

  modules: {
    workspace: 'Moj prostor',
    leads: 'Potencijalni klijenti',
    subscriptions: 'Pretplate',
    income: 'Prihodi',
    expenses: 'Troškovi',
    commissions: 'Provizije',
    offers: 'Ponude i dokumenti',
    clientAccess: 'Pristupi klijenata',
    timeTracking: 'Evidencija vremena',
    timeOff: 'Odsustva',
    announcements: 'Obaveštenja',
    support: 'Podrška',
    groupClients: 'Klijenti i posao',
    groupMoney: 'Novac',
    clients: 'Klijenti',
    projects: 'Projekti',
    services: 'Usluge',
    contracts: 'Ugovori',
    finance: 'Finansije',
    employees: 'Zaposleni',
    goals: 'Ciljevi i KPI',
    performance: 'Učinak',
    calendar: 'Kalendar',
    analytics: 'Analitika',

    groupMain: 'Pregled',
    groupBusiness: 'Poslovanje',
    groupTeam: 'Tim',
    groupTools: 'Alati',
    groupSystem: 'Sistem',
  },

  workspace: {
    title: 'Moj prostor',
    subtitle: 'Sve što je tvoje.',
    profileCard: 'Tvoj profil',
    tasksCard: 'Tvoji zadaci',
    earningsCard: 'Tvoja zarada',
    notificationsCard: 'Obaveštenja',
    tasksSoon: 'Zadaci koji su ti dodeljeni pojaviće se ovde.',
    earningsSoon: 'Tvoja plata, bonusi i nagrade pojaviće se ovde.',
    notificationsSoon: 'Poruke i podsetnici za tebe pojaviće se ovde.',
    openProfile: 'Otvori profil',
  },

  settingsHub: {
    administration: 'Administracija',
    administrationHint: 'Podešavanja cele firme. Svako se otvara kao zasebna stranica, pod svojom dozvolom.',
    requestsDesc: 'Odobri ili odbij one koji traže nalog.',
    rolesDesc: 'Odluči šta koja uloga sme.',
    organizationDesc: 'Sektori i nazivi radnih mesta.',
    auditDesc: 'Ko je šta uradio i kada.',
  },

  audit: {
    title: 'Revizioni dnevnik',
    subtitle: 'Ko je šta uradio i kada. Niko ne može da izmeni ni obriše zapis.',
    filterAction: 'Radnja',
    allActions: 'Sve radnje',
    filterActor: 'Osoba',
    allActors: 'Svi',
    searchPlaceholder: 'Pretraga po osobi ili predmetu',
    actor: 'Ko',
    action: 'Šta',
    target: 'Nad kim',
    when: 'Kada',
    details: 'Detalji',
    empty: 'Još ništa nije zabeleženo',
    emptyHint: 'Odobrenja, promene uloga i suspenzije pojavljuju se ovde kako se dešavaju.',
    noMatch: 'Nema zapisa koji odgovaraju',
    noMatchHint: 'Probaj drugu pretragu ili poništi filtere.',
    immutable: 'Samo dodavanje',
    immutableHint:
      'Zapisi mogu da se stvore ali nikad da se izmene ni obrišu — ni od koga, ni od vlasnika. To je ono što ih čini vrednim čitanja.',
    loadMore: 'Učitaj još',
    showing: 'Prikazano {n}',
  },

  nav: {
    dashboard: 'Kontrolna tabla',
    employees: 'Zaposleni',
    directory: 'Imenik',
    requests: 'Zahtevi za registraciju',
    roles: 'Uloge i dozvole',
    audit: 'Revizioni dnevnik',
    profile: 'Moj profil',
    settings: 'Podešavanja',
    sectionMain: 'Pregled',
    sectionPeople: 'Ljudi',
    sectionAdmin: 'Administracija',
    sectionAccount: 'Nalog',
    signOut: 'Odjavi se',
    openMenu: 'Otvori meni',
    closeMenu: 'Zatvori meni',
    futureModules: 'Uskoro',
  },

  theme: {
    label: 'Tema',
    dark: 'Tamna',
    light: 'Svetla',
    toggle: 'Promeni temu',
  },

  language: {
    label: 'Jezik',
    serbian: 'Srpski',
    english: 'English',
    switch: 'Promeni jezik',
  },

  status: {
    pending: 'Na čekanju',
    active: 'Aktivan',
    suspended: 'Suspendovan',
    rejected: 'Odbijen',
    deactivated: 'Deaktiviran',
  },

  employmentStatus: {
    full_time: 'Puno radno vreme',
    part_time: 'Skraćeno radno vreme',
    contractor: 'Saradnik po ugovoru',
    intern: 'Praktikant',
    former: 'Bivši zaposleni',
  },

  visibility: {
    label: 'Vidljivost',
    everyone: 'Svi',
    management: 'Samo menadžment',
    private: 'Privatno',
    everyoneHint: 'Svi zaposleni koji imaju pristup imeniku',
    managementHint: 'Ti, CEO i ovlašćeni menadžment',
    privateHint: 'Samo ti i CEO',
    ceoNotice:
      'CEO uvek zadržava pristup podacima potrebnim za upravljanje kompanijom. Podešavanja privatnosti određuju šta vide kolege.',
  },

  noteCategory: {
    performance: 'Učinak',
    strength: 'Prednost',
    improvement: 'Prostor za napredak',
    warning: 'Upozorenje',
    disciplinary: 'Disciplinska mera',
    recognition: 'Pohvala',
    general: 'Opšte',
  },

  permissionGroup: {
    employees: 'Zaposleni',
    requests: 'Zahtevi za registraciju',
    roles: 'Uloge i dozvole',
    organisation: 'Sektori i pozicije',
    business: 'Klijenti i projekti',
    finance: 'Novac',
    notes: 'CEO beleške',
    audit: 'Revizioni dnevnik',
    settings: 'Podešavanja kompanije',
  },

  permission: {
    employees: {
      view: {
        label: 'Pregled imenika',
        description:
          'Vidi spisak kolega: sliku, ime, poziciju i sektor. Ništa privatno.',
      },
      view_all: {
        label: 'Vidi sve',
        description:
          'U tom spisku vidi i ljude van svog sektora.',
      },
      view_private_info: {
        label: 'Vidi kontakte za menadžment',
        description:
          'Čita telefon i email onih koji su to postavili na samo menadžment. Ovo zalazi u privatne podatke.',
      },
      edit_professional: {
        label: 'Izmena radnih podataka',
        description:
          'Menja poziciju, sektor, dužnosti i datum početka. Ne i ulogu ni status naloga.',
      },
      manage_status: {
        label: 'Suspendovanje i aktiviranje',
        description:
          'Oduzima ili vraća pristup sistemu. Zapis se čuva u oba slučaja.',
      },
      export: {
        label: 'Izvoz podataka o zaposlenima',
        description:
          'Preuzima spisak zaposlenih kao fajl koji izlazi iz sistema.',
      },
    },
    registration_requests: {
      view: {
        label: 'Vidi ko se prijavio',
        description:
          'Otvara karticu Na čekanju i čita šta su kandidati poslali.',
      },
      approve: {
        label: 'Pušta ljude unutra',
        description:
          'Pretvara kandidata u aktivan nalog sa ulogom koju izabereš.',
      },
      reject: {
        label: 'Odbija kandidate',
        description:
          'Odbija zahtev, uz razlog koji ostaje zabeležen.',
      },
    },
    roles: {
      view: {
        label: 'Vidi uloge',
        description:
          'Otvara ovu stranicu i čita koja uloga šta sme.',
      },
      create: {
        label: 'Pravi uloge',
        description:
          'Dodaje nove uloge u firmu.',
      },
      edit: {
        label: 'Menja šta uloge smeju',
        description:
          'Čekira i odčekira dozvole. Time odmah menja šta svi nosioci te uloge mogu.',
      },
      deactivate: {
        label: 'Povlači ulogu',
        description:
          'Sprečava da se uloga dodeli nekom novom.',
      },
      assign: {
        label: 'Dodeljuje uloge ljudima',
        description:
          'Odlučuje ko nosi koju ulogu. Ko ovo ima, odlučuje šta drugi smeju.',
      },
    },
    departments: {
      manage: {
        label: 'Upravljanje sektorima',
        description:
          'Pravi, preimenuje i povlači sektore.',
      },
    },
    positions: {
      manage: {
        label: 'Upravljanje pozicijama',
        description:
          'Pravi, preimenuje i povlači nazive radnih mesta.',
      },
    },
    employee_notes: {
      view: {
        label: 'Čita privatne beleške',
        description:
          'Otvara CEO beleške o ljudima: učinak, upozorenja, disciplinske mere. Nikad vidljivo samoj osobi.',
      },
      create: {
        label: 'Piše privatne beleške',
        description:
          'Dodaje belešku u nečije dosije.',
      },
      edit: {
        label: 'Menja beleške',
        description:
          'Ispravlja belešku posle pisanja.',
      },
      delete: {
        label: 'Briše beleške',
        description:
          'Trajno uklanja belešku. Nema povratka.',
      },
    },
    audit_log: {
      view: {
        label: 'Čita istoriju',
        description:
          'Vidi ko je šta uradio i kada: promene uloga, odobrenja, suspenzije.',
      },
      export: {
        label: 'Izvozi istoriju',
        description:
          'Preuzima dnevnik kao fajl.',
      },
    },
    company_settings: {
      view: {
        label: 'Vidi podešavanja firme',
        description:
          'Čita naziv firme, jezik i podešavanja registracije.',
      },
      edit: {
        label: 'Menja podešavanja firme',
        description:
          'Menja ta podešavanja, uključujući i da li je registracija uopšte otvorena.',
      },
    },
  },

  errors: {
    generic: 'Došlo je do greške. Pokušaj ponovo.',
    network: 'Server nije dostupan. Proveri internet vezu.',
    forbidden: 'Nemaš dozvolu za tu radnju.',
    notFound: 'Nije pronađeno.',
    sessionExpired: 'Sesija je istekla. Prijavi se ponovo.',
    required: 'Ovo polje je obavezno.',
    invalidEmail: 'Unesi ispravnu email adresu.',
    passwordTooShort: 'Lozinka mora imati najmanje {min} karaktera.',
    passwordsDoNotMatch: 'Lozinke se ne poklapaju.',
    invalidPhone: 'Unesi ispravan broj telefona.',
    fileTooLarge: 'Fajl je prevelik. Najviše {max}.',
    fileWrongType: 'Nepodržan tip fajla. Koristi JPG, PNG ili WebP.',
    mustAcceptTerms: 'Moraš prihvatiti uslove da bi nastavio.',
  },

  soon: {
    title: 'Još nije napravljeno',
    text: 'Ovaj ekran stiže u kasnijoj fazi verzije 1.',
  },

  setup: {
    title: 'Firebase nije podešen',
    text: 'Kopiraj .env.example u .env, popuni vrednosti iz svog Firebase projekta i ponovo pokreni razvojni server.',
    missing: 'Nedostaju vrednosti',
    docs: 'Firebase Console → Project settings → General → Your apps',
  },

  a11y: {
    mainNavigation: 'Glavna navigacija',
    userMenu: 'Meni korisnika',
    breadcrumb: 'Putanja',
    loading: 'Učitavanje sadržaja',
  },

  notFound: {
    title: 'Stranica nije pronađena',
    text: 'Stranica koju tražiš ne postoji ili joj više nemaš pristup.',
    action: 'Nazad na kontrolnu tablu',
  },

  forbidden: {
    title: 'Pristup odbijen',
    text: 'Nemaš dozvolu za pregled ove stranice. Ako misliš da je ovo greška, obrati se CEO-u.',
    action: 'Nazad na kontrolnu tablu',
  },
}
