package sg.hundredacre.grid.di

import android.app.Application
import android.content.Context
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import sg.hundredacre.grid.BuildConfig
import sg.hundredacre.grid.data.api.PaymentApiService
import sg.hundredacre.grid.data.local.PaymentPreferencesManager
import sg.hundredacre.grid.payments.GridConnectionTokenProvider
import sg.hundredacre.grid.payments.PaymentAdapterFactory
import sg.hundredacre.grid.payments.PaymentRepository
import sg.hundredacre.grid.payments.StripePaymentAdapter
import sg.hundredacre.grid.payments.StripeTerminalManager
import sg.hundredacre.grid.payments.kpay.KPayCredentials
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object PaymentModule {

    @Provides
    @Singleton
    fun provideStripeTerminalManager(
        application: Application,
        connectionTokenProvider: GridConnectionTokenProvider
    ): StripeTerminalManager {
        return StripeTerminalManager(
            application = application,
            connectionTokenProvider = connectionTokenProvider
        )
    }

    @Provides
    @Singleton
    fun provideConnectionTokenProvider(
        paymentApiService: PaymentApiService
    ): GridConnectionTokenProvider {
        return GridConnectionTokenProvider(paymentApiService)
    }

    @Provides
    @Singleton
    fun provideStripePaymentAdapter(
        stripeTerminalManager: StripeTerminalManager,
        paymentApiService: PaymentApiService
    ): StripePaymentAdapter {
        return StripePaymentAdapter(
            stripeTerminalManager = stripeTerminalManager,
            paymentApiService = paymentApiService
        )
    }

    @Provides
    @Singleton
    fun providePaymentAdapterFactory(
        stripePaymentAdapter: StripePaymentAdapter,
        kpayCredentials: KPayCredentials
    ): PaymentAdapterFactory {
        return PaymentAdapterFactory(
            stripePaymentAdapter = stripePaymentAdapter,
            kpayCredentials = kpayCredentials
        )
    }

    @Provides
    @Singleton
    fun providePaymentRepository(
        application: Application,
        paymentAdapterFactory: PaymentAdapterFactory,
        paymentPreferencesManager: PaymentPreferencesManager
    ): PaymentRepository {
        return PaymentRepository(
            application = application,
            paymentAdapterFactory = paymentAdapterFactory,
            paymentPreferencesManager = paymentPreferencesManager
        )
    }

    @Provides
    @Singleton
    fun providePaymentPreferencesManager(
        @ApplicationContext context: Context
    ): PaymentPreferencesManager {
        return PaymentPreferencesManager(context)
    }

    @Provides
    @Singleton
    fun provideKPayCredentials(): KPayCredentials {
        return KPayCredentials(
            appId = BuildConfig.KPAY_APP_ID,
            appSecret = BuildConfig.KPAY_APP_SECRET,
            managerPassword = "123456",
            terminalIp = BuildConfig.KPAY_TERMINAL_IP,
            callbackPort = BuildConfig.KPAY_CALLBACK_PORT
        )
    }
}
