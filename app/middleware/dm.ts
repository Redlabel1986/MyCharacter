export default defineNuxtRouteMiddleware(() => {
  const { loggedIn, user } = useUserSession()
  if (!loggedIn.value) return navigateTo('/login')
  const role = user.value?.role
  if (role !== 'dm' && role !== 'admin') {
    return abortNavigation(createError({ statusCode: 403, statusMessage: 'Nur für Dungeon Master.' }))
  }
})
