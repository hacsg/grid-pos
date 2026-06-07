package sg.hundredacre.grid.di

import android.content.Context
import androidx.room.Room
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import sg.hundredacre.grid.data.local.CartDao
import sg.hundredacre.grid.data.local.CategoryDao
import sg.hundredacre.grid.data.local.GridDatabase
import sg.hundredacre.grid.data.local.OrderDao
import sg.hundredacre.grid.data.local.ProductDao
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): GridDatabase {
        return Room.databaseBuilder(
            context,
            GridDatabase::class.java,
            "grid_pos_database"
        ).fallbackToDestructiveMigration()
            .build()
    }

    @Provides
    fun provideCategoryDao(database: GridDatabase): CategoryDao = database.categoryDao()

    @Provides
    fun provideProductDao(database: GridDatabase): ProductDao = database.productDao()

    @Provides
    fun provideCartDao(database: GridDatabase): CartDao = database.cartDao()

    @Provides
    fun provideOrderDao(database: GridDatabase): OrderDao = database.orderDao()
}