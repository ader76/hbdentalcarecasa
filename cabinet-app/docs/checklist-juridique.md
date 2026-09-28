# Checklist juridique et réglementaire — à faire valider par un professionnel

> Ce document liste des **questions**, pas des réponses. Les mesures techniques de l'application ne suffisent pas à établir la conformité. Pays supposé du cabinet : **Maroc (Casablanca)** — à confirmer.

## Protection des données (Maroc : loi n° 09-08 et CNDP — à confirmer par un juriste)
- [ ] Quelle formalité auprès de la CNDP pour un traitement de données de santé (déclaration ou demande d'autorisation) ? Délai ?
- [ ] L'hébergement chez un prestataire situé hors du Maroc (ex. région UE de Supabase) est-il un **transfert international** soumis à autorisation ? Quelles régions/pays sont acceptables ?
- [ ] Faut-il un hébergeur situé au Maroc ou certifié pour les données de santé ?
- [ ] Contrat de sous-traitance (DPA) avec l'hébergeur de base de données et l'hébergeur de l'application : clauses obligatoires ?
- [ ] Information des patients (mention sur la numérisation des fiches, droits d'accès/rectification/opposition) : texte et support (affichage en salle d'attente ?).
- [ ] Faut-il recueillir un consentement, ou le fondement « suivi médical » suffit-il ?
- [ ] Procédure et délai de notification en cas de violation de données.
- [ ] Registre des traitements : contenu attendu.

## Déontologie et dossier médical
- [ ] Durée de conservation légale des dossiers dentaires (papier et numérique) ; point de départ (dernière consultation ? majorité du patient ?).
- [ ] La copie numérique a-t-elle une valeur probante ? Le papier doit-il être conservé (l'application ne le remplace pas).
- [ ] Règles de l'Ordre (ONMD) sur la tenue et l'accès au dossier, le secret professionnel, l'accès des assistant(e)s.
- [ ] Transmission du dossier à un confrère ou au patient : format et traçabilité.

## Sécurité et contrats
- [ ] Obligations éventuelles au titre de la cybersécurité (loi 05-20) selon la taille du cabinet.
- [ ] Localisation, chiffrement et durée de rétention des **sauvegardes** (y compris celles de l'hébergeur).
- [ ] Politique de suppression : à la fin de la durée de conservation, comment effacer (base, stockage, sauvegardes) ?
- [ ] Export : format à fournir si le patient ou le cabinet le demande.

## Futures fonctionnalités
- [ ] OCR/IA externe : conservation, région de traitement, usage pour l'entraînement, suppression — transfert autorisé ?
- [ ] Ordonnances : mentions obligatoires, signature, source officielle des médicaments au Maroc, responsabilité.
